export default function reduxDevToolsMiddleware(options) {
  return (store) => {
    const extension = getExtension();
    if (extension) {
      const devTools = extension.connect({ name: "Restato", ...options });
      devTools.init(store.getState());
      devTools.subscribe((msg) => {
        if (msg.type === "DISPATCH") {
          switch (msg.payload.type) {
            case "JUMP_TO_ACTION":
            case "JUMP_TO_STATE":
              store.setState(JSON.parse(msg.state));
              break;
            case "COMMIT":
              devTools.init(store.getState());
              break;
            default:
          }
        }
      });

      const getType = action => action.name || "/anonymous";

      return {
        execute(action, args, next) {
          next(action, args); // execute action
          devTools.send({ type: getType(action), args }, store.getState());
        },

        asyncExecuted(action, args, next) {
          next(); // commit changes
          devTools.send({ type: `${getType(action)}/async`, args }, store.getState());
        },

        destroy() {
          devTools.unsubscribe();
        }
      }
    }
  };
}

function getExtension() {
  if (typeof globalThis !== 'undefined') {
    return globalThis.__REDUX_DEVTOOLS_EXTENSION__;
  }
  if (typeof window !== 'undefined') {
    return window.__REDUX_DEVTOOLS_EXTENSION__;
  }
}
