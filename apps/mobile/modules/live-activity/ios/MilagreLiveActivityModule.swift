import ActivityKit
import Expo
import ExpoModulesCore
import EXUpdates
import UIKit

// Owned by the app process. Widget state contains only presentation and routing IDs.
@MainActor public enum ActivityAnswers {
  private static var root: UIView?
  private static var launcher: ActivityBundleLauncher?
  private static var starting = false
  private static var pending: [String: [String: Any]] = [:]
  private static var completions: [String: CheckedContinuation<String, Never>] = [:]
  static var emit: (([String: Any]) -> Void)?

  public static func perform(hostId: String, target: String, position: Int, option: Int) async {
    guard #available(iOS 17.0, *),
      let activity = Activity<AgentActivityAttributes>.activities.first(where: { $0.attributes.hostId == hostId }),
      let question = activity.content.state.question,
      question.target == target, question.position == position, question.canAnswer,
      question.choices.contains(where: { $0.index == option }),
      activity.content.staleDate.map({ $0 > Date() }) ?? true,
      activity.content.state.delivery == nil else { return }
    var sending = activity.content.state
    sending.delivery = "Sending"
    await activity.update(ActivityContent(state: sending, staleDate: activity.content.staleDate))
    let id = UUID().uuidString
    let status = await withCheckedContinuation { continuation in
      completions[id] = continuation
      let action: [String: Any] = ["id": id, "hostId": hostId, "target": target, "position": position, "option": option]
      pending[id] = action
      if let emit { emit(action) }
      else { startRuntime() }
      Task { @MainActor in
        try? await Task.sleep(nanoseconds: 20_000_000_000)
        finish(id: id, status: "unknown")
      }
    }
    guard status != "accepted", status != "draft" else { return }
    // A lost acknowledgement must never trigger an automatic retry.
    var failed = activity.content.state
    failed.delivery = "Check Chat"
    await activity.update(ActivityContent(state: failed, staleDate: activity.content.staleDate))
  }
  private static func startRuntime() {
    guard root == nil, !starting else { return }
    // A normal scene already starting owns its bundle launch and event listener.
    guard UIApplication.shared.connectedScenes.isEmpty else { return }
    starting = true
    AppController.initializeWithoutStarting()
    let controller = AppController.sharedInstance
    if !controller.isActiveController { mount(bundleURL: nil); return }
    if controller.isStarted { mount(bundleURL: controller.launchAssetUrl()); return }
    let delegate = ActivityBundleLauncher()
    launcher = delegate
    controller.delegate = delegate
    controller.start()
  }
  fileprivate static func mount(bundleURL: URL?) {
    guard let provider = UIApplication.shared.delegate as? ExpoReactNativeFactoryProvider,
      let factory = provider.reactNativeFactory as? ExpoReactNativeFactory else { return }
    root = factory.recreateRootView(withBundleURL: bundleURL, moduleName: "MilagreLiveActivityTask", initialProps: [:], launchOptions: [:])
  }
  static func drain() -> [[String: Any]] { Array(pending.values) }
  static func finish(id: String, status: String) {
    pending.removeValue(forKey: id)
    completions.removeValue(forKey: id)?.resume(returning: status)
  }
}

public class MilagreLiveActivityModule: Module {
  @MainActor private var retainedHosts = Set<String>()
  public func definition() -> ModuleDefinition {
    Name("MilagreLiveActivity")
    Events("answerRequest", "pushToken")
    OnStartObserving {
      Task { @MainActor [weak self] in
        ActivityAnswers.emit = { [weak self] action in self?.sendEvent("answerRequest", action) }
      }
    }
    OnStopObserving { Task { @MainActor in ActivityAnswers.emit = nil } }
    AsyncFunction("availableAsync") { () -> Bool in ActivityAuthorizationInfo().areActivitiesEnabled }
    AsyncFunction("pendingActionsAsync") { () async -> [[String: Any]] in await ActivityAnswers.drain() }
    AsyncFunction("syncAsync") { (hostId: String, hostName: String, scheme: String, json: String) async throws in
      try await self.sync(hostId: hostId, hostName: hostName, scheme: scheme, json: json)
    }
    AsyncFunction("completeAsync") { (id: String, hostId: String, status: String, json: String?) async throws in
      if let json { try await self.sync(hostId: hostId, hostName: "", scheme: "milagre", json: json, delivery: status == "accepted" ? "Answer sent" : nil, allowStart: false) }
      await ActivityAnswers.finish(id: id, status: status)
    }
    AsyncFunction("retainHostsAsync") { (hostIds: [String]) async in
      await self.retain(hostIds)
    }
    AsyncFunction("endAsync") { (hostId: String) async in
      await self.end(hostId)
    }
  }
  @MainActor private func retain(_ hostIds: [String]) async {
    retainedHosts = Set(hostIds)
    for activity in Activity<AgentActivityAttributes>.activities where !retainedHosts.contains(activity.attributes.hostId) {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
  @MainActor private func end(_ hostId: String) async {
    retainedHosts.remove(hostId)
    for activity in Activity<AgentActivityAttributes>.activities where activity.attributes.hostId == hostId {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
  @MainActor private func sync(hostId: String, hostName: String, scheme: String, json: String, delivery: String? = nil, allowStart: Bool = true) async throws {
    guard !allowStart || retainedHosts.contains(hostId) else { return }
    guard json.utf8.count <= 3500, let data = json.data(using: .utf8) else { throw ActivityError.invalidContent }
    var state = try JSONDecoder().decode(AgentActivityAttributes.ContentState.self, from: data)
    guard state.version == 1, state.rows.count <= 3, (state.question?.choices.count ?? 0) <= 2 else { throw ActivityError.invalidContent }
    state.delivery = state.question == nil ? delivery : nil
    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(90))
    let existing = Activity<AgentActivityAttributes>.activities.first(where: { $0.attributes.hostId == hostId })
    if let existing {
      if state.runningCount == 0 && state.waitingCount == 0 {
        await existing.end(content, dismissalPolicy: delivery == "Answer sent" ? .after(Date().addingTimeInterval(15)) : .immediate)
      } else { await existing.update(content) }
    } else if allowStart && (state.runningCount > 0 || state.waitingCount > 0) {
      let activity = try Activity.request(attributes: AgentActivityAttributes(hostId: hostId, hostName: hostName, scheme: scheme), content: content, pushType: .token)
      Task { [weak self] in
        for await token in activity.pushTokenUpdates {
          self?.sendEvent("pushToken", ["hostId": hostId, "activityId": activity.id, "token": token.map { String(format: "%02x", $0) }.joined()])
        }
      }
    }
  }
}
private enum ActivityError: Error { case invalidContent }

private final class ActivityBundleLauncher: NSObject, AppControllerDelegate {
  func appController(_ appController: AppControllerInterface, didStartWithSuccess success: Bool) {
    let url = appController.launchAssetUrl()
    guard let url else { return }
    Task { @MainActor in ActivityAnswers.mount(bundleURL: url) }
  }
}
