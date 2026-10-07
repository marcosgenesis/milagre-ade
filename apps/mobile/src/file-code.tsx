import { useMemo } from "react";
import { Text, useColorScheme } from "react-native";
import { highlightFile, MAX_SYNTAX_CHARACTERS, syntaxColors } from "@milagre/shared/file-syntax";
import { fonts } from "./theme";
import { colors, styles } from "./ui";

export function FileCode({ text, name }: { text: string; name: string }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const tokens = useMemo(() => highlightFile(text, name), [text, name]);
  return (
    <>
      <Text selectable style={{ color: colors.ink, fontSize: 13, lineHeight: 20, fontFamily: fonts.mono }}>
        {tokens.map((token, index) => (
          <Text key={index} style={{ color: syntaxColors[token.kind][scheme] }}>
            {token.text}
          </Text>
        ))}
      </Text>
      {text.length > MAX_SYNTAX_CHARACTERS && <Text style={styles.caption}>Large file shown without syntax colors.</Text>}
    </>
  );
}
