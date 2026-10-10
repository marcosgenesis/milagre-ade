// react-lang mounts its Inspect widget on the page when NODE_ENV is "development" (the dev app, the Electron checks),
// unless this flag is already set. Import this before every `@openuidev/react-lang` import (ES modules evaluate in import order): react-lang reads the flag as it loads.
(globalThis as Record<symbol, unknown>)[Symbol.for("openui.devtools.autoMount")] = true;
