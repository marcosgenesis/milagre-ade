import { createContext, createElement, Fragment, useCallback, useContext, useEffect, useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import type { ActionEvent, ComponentRenderProps as CoreComponentRenderProps, ElementNode, Library, ParseResult } from "@openuidev/lang-core";
import { genuiActionEvents, parseGenui } from "./genui.ts";

export { createLibrary, defineComponent } from "@openuidev/lang-core";
export type { ActionEvent, ParseResult } from "@openuidev/lang-core";
export type ComponentRenderProps<P = Record<string, unknown>> = CoreComponentRenderProps<P, ReactNode>;

type Trigger = (label: string, formName?: string, action?: unknown) => void;
const RenderContext = createContext<{ isStreaming: boolean; trigger: Trigger }>({ isStreaming: true, trigger: () => {} });
export const useIsStreaming = () => useContext(RenderContext).isStreaming;
export const useTriggerAction = () => useContext(RenderContext).trigger;

/** OpenUI's native export still mounts HTML. This adapter mounts only the platform components in the library. */
export function Renderer({
  response,
  library,
  isStreaming,
  onParseResult,
  onAction,
}: {
  response: string;
  library: Library;
  isStreaming: boolean;
  onParseResult?: (result: ParseResult | null) => void;
  onAction?: (event: ActionEvent) => void;
}) {
  const parsed = useMemo(() => parseGenui(response), [response]);
  useEffect(() => {
    onParseResult?.(parsed);
  }, [parsed, onParseResult]);
  const trigger = useCallback<Trigger>(
    (label, _formName, action) => {
      if (isStreaming) return;
      for (const event of genuiActionEvents(label, action)) onAction?.(event);
    },
    [isStreaming, onAction],
  );
  const context = useMemo(() => ({ isStreaming, trigger }), [isStreaming, trigger]);
  const renderNode = (value: unknown): ReactNode => {
    if (Array.isArray(value)) return value.map((child, index) => createElement(Fragment, { key: index }, renderNode(child)));
    if (!value || typeof value !== "object" || !("type" in value) || value.type !== "element") return null;
    const node = value as ElementNode;
    const component = library.components[node.typeName]?.component as ComponentType<ComponentRenderProps<Record<string, unknown>>> | undefined;
    return component ? createElement(component, { props: node.props, renderNode, statementId: node.statementId }) : null;
  };
  return <RenderContext value={context}>{renderNode(parsed.root)}</RenderContext>;
}
