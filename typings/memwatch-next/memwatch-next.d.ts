
declare module "memwatch-next" {
    import events = require('events');
    var memwatch: events.EventEmitter;
    export = memwatch;
}

