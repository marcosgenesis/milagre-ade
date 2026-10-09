import AppIntents
#if !WIDGET_EXTENSION
internal import MilagreLiveActivity
#endif

@available(iOS 17.0, *)
struct MilagreAnswerIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Answer agent question"
  static var openAppWhenRun = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @available(iOS 26.0, *) static var supportedModes: IntentModes { .background }
  @Parameter(title: "Computer") var hostId: String
  @Parameter(title: "Request") var target: String
  @Parameter(title: "Question") var position: Int
  @Parameter(title: "Choice") var option: Int
  init() {}
  init(hostId: String, target: String, position: Int, option: Int) {
    self.hostId = hostId; self.target = target; self.position = position; self.option = option
  }
  func perform() async throws -> some IntentResult {
#if !WIDGET_EXTENSION
    await ActivityAnswers.perform(hostId: hostId, target: target, position: position, option: option)
#endif
    return .result()
  }
}
