
export type Selector<T, V> = (state: T) => V;

export type Action<T> = (state: T, ...args: unknown[]) => void;
export type Dispatch<T> = (action: Action<T>, ...args: unknown[]) => void;

export type StoreBasic<T> = {
  dispatch: Dispatch<T>;
  getState: () => T;
  setState: (state: T) => void;
}

export type Middleware<T> = (store: StoreBasic<T>) => {
  execute?: (
    action: Action<T>,
    args: unknown[],
    next: (action: Action<T>, args: unknown[]) => void
  ) => any;

  asyncExecuted?: (
    action: Action<T>,
    args: unknown[],
    next: () => void
  ) => void;

  destroy?: () => void;
}

export type DefaultState = Record<keyof any, any>;

export type Store<T> = StoreBasic<T> & {
  destroy: () => void;
  select: <V>(selector: Selector<T, V>) => V;
  subscribe: <V>(selector: Selector<T, V>) => (() => void);
  addMiddlewares: (...middlewares: Middleware<T>[]) => void;
};
