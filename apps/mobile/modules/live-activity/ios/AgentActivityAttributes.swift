import ActivityKit
import Foundation

public struct AgentActivityAttributes: ActivityAttributes {
  public struct Choice: Codable, Hashable { public var index: Int; public var label: String }
  public struct Question: Codable, Hashable {
    public var target: String
    public var title: String
    public var text: String
    public var position: Int
    public var total: Int
    public var choices: [Choice]
    public var canAnswer: Bool
  }
  public struct Row: Codable, Hashable { public var title: String; public var status: String }
  public struct ContentState: Codable, Hashable {
    public var version: Int
    public var updatedAt: Double
    public var runningCount: Int
    public var waitingCount: Int
    public var rows: [Row]
    public var question: Question?
    public var delivery: String?
  }
  public var hostId: String
  public var hostName: String
  public var scheme: String
  public init(hostId: String, hostName: String, scheme: String) {
    self.hostId = hostId; self.hostName = hostName; self.scheme = scheme
  }
  public func url(target: String? = nil) -> URL? {
    var parts = URLComponents()
    parts.scheme = scheme; parts.host = "live-activity"
    parts.queryItems = [URLQueryItem(name: "hostId", value: hostId)]
    if let target { parts.queryItems?.append(URLQueryItem(name: "target", value: target)) }
    return parts.url
  }
}
