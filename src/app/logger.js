import * as serilog from "structured-log";

export class Logger {
    constructor() {
        this._logger = serilog.configure().writeTo(new serilog.ConsoleSink()).create();
    }

    debug(message, params = []) {
        this._logger.debug(message, params);
    }
}