import { Store, DefaultState } from "./commons";

export function createStore<T = DefaultState>(initState?: T): Store<T>;
