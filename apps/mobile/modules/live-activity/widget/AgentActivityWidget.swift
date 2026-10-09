import ActivityKit
import SwiftUI
import WidgetKit

private let orange = Color(red: 1, green: 0.63, blue: 0.28)
private let green = Color(red: 0.44, green: 0.87, blue: 0.62)

struct ActivityPanel: View {
  let context: ActivityViewContext<AgentActivityAttributes>
  @Environment(\.dynamicTypeSize) private var textSize
  var state: AgentActivityAttributes.ContentState { context.state }
  var accent: Color { state.waitingCount > 0 ? orange : green }
  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      HStack(spacing: 7) {
        MilagreMark().fill(.white).frame(width: 18, height: 18)
        Text(state.question?.title ?? state.rows.first?.title ?? "Chat").font(.system(size: 13, weight: .semibold)).lineLimit(1)
        Spacer(minLength: 4)
        Text(context.isStale ? "Updated earlier" : state.delivery ?? (state.waitingCount > 0 ? "Needs you" : "Working"))
          .font(.system(size: 11, weight: .medium)).foregroundStyle(accent)
      }
      if let question = state.question {
        ViewThatFits {
          if !context.isStale && state.delivery == nil && question.canAnswer && !textSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 9) {
              Text(question.text).font(.system(size: 14, weight: .medium)).fixedSize(horizontal: false, vertical: true)
              HStack(spacing: 6) {
                ForEach(question.choices, id: \.index) { choice in
                  Button(intent: MilagreAnswerIntent(hostId: context.attributes.hostId, target: question.target, position: question.position, option: choice.index)) {
                    Text(choice.label).font(.system(size: 12, weight: .medium)).fixedSize().padding(.horizontal, 10).frame(height: 32)
                  }.buttonStyle(.plain).background(accent.opacity(0.16), in: RoundedRectangle(cornerRadius: 9))
                }
                openChat(question)
                position(question)
              }.fixedSize(horizontal: true, vertical: false)
            }.fixedSize(horizontal: false, vertical: true)
          }
          VStack(alignment: .leading, spacing: 9) {
            Text(question.text).font(.system(size: 14, weight: .medium)).lineLimit(textSize.isAccessibilitySize ? 1 : 2)
            HStack(spacing: 6) {
              openChat(question)
              Spacer(minLength: 0)
              position(question)
            }
          }
        }.frame(height: 76, alignment: .topLeading)
      } else {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
          Text("\(state.runningCount)").font(.system(size: 25, weight: .semibold, design: .rounded))
          Text(state.runningCount == 1 ? "agent running" : "agents running").font(.system(size: 13)).foregroundStyle(.secondary)
        }
        ForEach(Array(state.rows.dropFirst().prefix(textSize.isAccessibilitySize ? 0 : 2).enumerated()), id: \.offset) { _, row in
          HStack(spacing: 6) {
            Circle().fill(green).frame(width: 5, height: 5)
            Text(row.title).font(.system(size: 12)).lineLimit(1)
            Spacer(minLength: 8)
            Text(row.status).font(.system(size: 11)).foregroundStyle(.secondary)
          }
        }
      }
    }
    .padding(14).foregroundStyle(.white)
    .activityBackgroundTint(Color(red: 0.07, green: 0.08, blue: 0.09))
    .activitySystemActionForegroundColor(.white)
    .widgetURL(context.attributes.url(target: state.question?.target))
  }

  @ViewBuilder private func position(_ question: AgentActivityAttributes.Question) -> some View {
    if question.total > 1 { Text("\(question.position)/\(question.total)").font(.system(size: 10)).foregroundStyle(.secondary) }
  }

  @ViewBuilder private func openChat(_ question: AgentActivityAttributes.Question) -> some View {
    if let url = context.attributes.url(target: question.target) {
      Link(destination: url) {
        Text("Open Chat").font(.system(size: 12, weight: .medium)).fixedSize().padding(.horizontal, 10)
      }.frame(height: 32).background(Color.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 9))
        .accessibilityLabel("Open Chat")
    }
  }
}

@main struct AgentActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AgentActivityAttributes.self) { context in
      ActivityPanel(context: context)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) { ActivityPanel(context: context) }
      } compactLeading: {
        MilagreMark().fill(.white).frame(width: 18, height: 18)
      } compactTrailing: {
        Text("\(context.state.waitingCount > 0 ? context.state.waitingCount : context.state.runningCount)").foregroundStyle(context.state.waitingCount > 0 ? orange : green)
      } minimal: {
        MilagreMark().fill(.white).frame(width: 18, height: 18)
      }
      .widgetURL(context.attributes.url(target: context.state.question?.target))
      .keylineTint(context.state.waitingCount > 0 ? orange : green)
    }
  }
}

private struct MilagreMark: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: 69.528, y: 1.96636))
    path.addCurve(to: CGPoint(x: 76.4169, y: 1.96636), control1: CGPoint(x: 71.0759, y: -0.655453), control2: CGPoint(x: 74.869, y: -0.655453))
    path.addLine(to: CGPoint(x: 91.0103, y: 26.6837))
    path.addCurve(to: CGPoint(x: 92.4211, y: 28.0945), control1: CGPoint(x: 91.3538, y: 27.2656), control2: CGPoint(x: 91.8392, y: 27.751))
    path.addLine(to: CGPoint(x: 117.138, y: 42.6879))
    path.addCurve(to: CGPoint(x: 117.138, y: 49.5768), control1: CGPoint(x: 119.76, y: 44.2358), control2: CGPoint(x: 119.76, y: 48.0289))
    path.addLine(to: CGPoint(x: 92.4211, y: 64.1702))
    path.addCurve(to: CGPoint(x: 91.0103, y: 65.581), control1: CGPoint(x: 91.8392, y: 64.5137), control2: CGPoint(x: 91.3538, y: 64.9991))
    path.addLine(to: CGPoint(x: 76.4169, y: 90.2983))
    path.addCurve(to: CGPoint(x: 69.528, y: 90.2983), control1: CGPoint(x: 74.869, y: 92.9201), control2: CGPoint(x: 71.0759, y: 92.9201))
    path.addLine(to: CGPoint(x: 54.9347, y: 65.581))
    path.addCurve(to: CGPoint(x: 53.5238, y: 64.1702), control1: CGPoint(x: 54.5911, y: 64.9991), control2: CGPoint(x: 54.1057, y: 64.5137))
    path.addLine(to: CGPoint(x: 28.8065, y: 49.5768))
    path.addCurve(to: CGPoint(x: 28.8065, y: 42.6879), control1: CGPoint(x: 26.1847, y: 48.0289), control2: CGPoint(x: 26.1847, y: 44.2358))
    path.addLine(to: CGPoint(x: 53.5238, y: 28.0945))
    path.addCurve(to: CGPoint(x: 54.9347, y: 26.6837), control1: CGPoint(x: 54.1057, y: 27.751), control2: CGPoint(x: 54.5911, y: 27.2656))
    path.addLine(to: CGPoint(x: 69.528, y: 1.96636))
    path.closeSubpath()
    path.move(to: CGPoint(x: 49.6983, y: 66.5562))
    path.addLine(to: CGPoint(x: 21.6836, y: 116.174))
    path.addCurve(to: CGPoint(x: 26.0372, y: 123.632), control1: CGPoint(x: 19.802, y: 119.507), control2: CGPoint(x: 22.2098, y: 123.632))
    path.addLine(to: CGPoint(x: 39.9727, y: 123.632))
    path.addLine(to: CGPoint(x: 54.9727, y: 100.132))
    path.addLine(to: CGPoint(x: 66.9727, y: 119.632))
    path.addLine(to: CGPoint(x: 51.9727, y: 144.132))
    path.addLine(to: CGPoint(x: 26.0372, y: 144.132))
    path.addCurve(to: CGPoint(x: 3.27837, y: 105.561), control1: CGPoint(x: 6.24066, y: 144.132), control2: CGPoint(x: -6.29344, y: 122.89))
    path.addLine(to: CGPoint(x: 30.9405, y: 55.4819))
    path.addLine(to: CGPoint(x: 49.6983, y: 66.5562))
    path.closeSubpath()
    path.move(to: CGPoint(x: 142.666, y: 105.561))
    path.addCurve(to: CGPoint(x: 119.907, y: 144.132), control1: CGPoint(x: 152.238, y: 122.89), control2: CGPoint(x: 139.704, y: 144.132))
    path.addLine(to: CGPoint(x: 93.9728, y: 144.132))
    path.addLine(to: CGPoint(x: 78.9728, y: 119.632))
    path.addLine(to: CGPoint(x: 90.9728, y: 100.132))
    path.addLine(to: CGPoint(x: 105.973, y: 123.632))
    path.addLine(to: CGPoint(x: 119.907, y: 123.632))
    path.addCurve(to: CGPoint(x: 124.261, y: 116.174), control1: CGPoint(x: 123.735, y: 123.632), control2: CGPoint(x: 126.143, y: 119.507))
    path.addLine(to: CGPoint(x: 96.2462, y: 66.5562))
    path.addLine(to: CGPoint(x: 115.004, y: 55.4819))
    path.addLine(to: CGPoint(x: 142.666, y: 105.561))
    path.closeSubpath()
    return path.applying(CGAffineTransform(scaleX: rect.width / 146, y: rect.height / 145))
  }
}
