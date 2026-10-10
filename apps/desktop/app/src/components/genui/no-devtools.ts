// react-lang mounts its Inspect widget on the page when NODE_ENV is "development" (the dev app, the Electron checks),
// unless this flag is already set. Import this before `@openuidev/react-lang`: ES modules evaluate in import order.
(globalThis as Record<symbol, unknown>)[Symbol.for("openui.devtools.autoMount")] = true;
