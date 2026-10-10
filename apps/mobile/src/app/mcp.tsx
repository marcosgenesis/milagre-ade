import { Stack } from "expo-router";
import { PageScroll } from "../ui";
import { McpSection } from "../mcp-section";

export default function McpScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "MCP" }} />
      <PageScroll>
        <McpSection />
      </PageScroll>
    </>
  );
}
