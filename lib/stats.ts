/// <reference path='../typings/tsd.d.ts' />

import http = require('http');
import net = require('net');
import conf = require('./config');
import memwatch = require('memwatch-next');
import usage = require('usage');
import fs = require('fs');
import _ = require('lodash');

class StatsLogger
{
    static startTime: number = Date.now();

    private out: fs.WriteStream;
    private printHeader: boolean;

    constructor(outfile: string)
    {
      this.out = fs.createWriteStream(outfile);
      this.printHeader = true;
    }

    private printFields(stats: any, printHeaders: boolean = false, headerPrefix: string = ''): void
    {
      _.forOwn(stats,
               (prop: any, key: string): void => {
                  // Unwrap object
                  if (typeof prop === 'object') {
                      if (printHeaders) {
                        headerPrefix += key + '-';
                      }
                      this.printFields(prop, printHeaders, headerPrefix);
                  } else {
                      if (printHeaders) {
                        this.out.write(headerPrefix + key);
                      } else {
                        this.out.write(prop.toString());
                      }
                      this.out.write(' ');
                  }
               });
    }

    public printStats(stats: any): void
    {
        if (!stats) {
            return;
        }

        if (this.printHeader) {
            this.out.write('time ');
            this.printFields(stats, true /* printHeaders */);
            this.out.write('\n');
            this.printHeader = false;
        }
        this.out.write([Date.now() - StatsLogger.startTime] + ' ');
        this.printFields(stats);
        this.out.write('\n');
    }
}

class GCWatcher extends StatsLogger
{
    constructor()
    {
        super('gc_stats.txt');

        memwatch.on('stats',
                    (stats: any): void => {
                        this.printStats(stats);
                    });
    }

}

class ProcessWatcher extends StatsLogger
{
  constructor(interval: number)
  {
    super('process_stats.txt');

    setInterval((): void =>
                {
                    usage.lookup(process.pid,
                                 { keepHistory: true },
                                 (error: Error,
                                  result: any): void => {
                                     this.printStats(result);
        	                       });
                },
                interval);
  }
}

class ServerWatcher extends StatsLogger
{
    connectionCount: number;
    bytesRead: number;
    bytesWritten: number;

    constructor(servers: http.Server[])
    {
        super('server_stats.txt');

        this.connectionCount = 0;
        this.bytesRead = 0;
        this.bytesWritten = 0;

        servers.forEach((server: http.Server): void => {
            server.on('connection',
                      (socket: net.Socket): void => {
                        ++this.connectionCount;
                        this.printStats(this.getStats());
                        socket.on('close',
                                  ((): void => {
                                    --this.connectionCount;
                                    this.bytesRead += socket.bytesRead;
                                    this.bytesWritten += socket.bytesWritten;
                                    this.printStats(this.getStats());
                      }));
                });
        });
    }


    private getStats(): any {
      return { connections: this.connectionCount,
               bytesSent: this.bytesWritten,
               bytesReceived: this.bytesRead
             };
    }
}

export class Generator
{
    private gcWatcher: GCWatcher;
    private serverWatcher: ServerWatcher;
    private processWatcher: ProcessWatcher;

    constructor(servers: http.Server[])
    {
       this.gcWatcher = new GCWatcher();
       this.serverWatcher = new ServerWatcher(servers);
       this.processWatcher = new ProcessWatcher(1000 /* polling interval in ms */);
    }
}
