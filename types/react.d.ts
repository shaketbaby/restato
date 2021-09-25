import { Store, Selector, Dispatch, DefaultState } from "./commons";

type UseSelector<T> = <V>(selector: Selector<T, V>) => V;

type ReactStore<T> = Store<T> & {
  useSelector: UseSelector<T>;
}

export function createStore<T = DefaultState>(initState?: T): ReactStore<T>;

export const store: ReactStore<DefaultState>;
export const dispatch: Dispatch<DefaultState>;
export const useSelector: UseSelector<DefaultState>;
