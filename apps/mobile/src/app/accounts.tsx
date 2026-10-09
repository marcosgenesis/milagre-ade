import { Stack } from "expo-router";
import { PageScroll } from "../ui";
import { AccountsSection } from "../accounts-section";

export default function AccountsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Accounts" }} />
      <PageScroll>
        <AccountsSection />
      </PageScroll>
    </>
  );
}
