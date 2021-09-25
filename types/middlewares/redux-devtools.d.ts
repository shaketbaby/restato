import { Middleware } from "../commons";

export default function reduxDevtoolsMiddleware<T>(reduxDevToolsOptions?: Record<string, any>): Middleware<T>
