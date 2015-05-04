/// <reference path='../typings/tsd.d.ts' />

import http = require('http');
import conf = require('./config');
import memwatch = require('memwatch-next')
import fs = require('fs');
import _ = require('lodash');


class StatsLogger
{
    private out: fs.WriteStream;
    private printHeader: boolean;
    static startTime = Date.now();
    
    constructor(outfile: string)
    {
      this.out = fs.createWriteStream(outfile);
      this.printHeader = true;  
    }
    
    private printFields(ar: any[])
    {
        ar.forEach((field: any, index: number): void => {
            this.out.write(field.toString());
            if (index != (ar.length -1)) {
                this.out.write(' ');
            }
        });
        this.out.write('\n');
    }

    printStats(stats: any): void 
    {
        if (this.printHeader) {
            this.printFields(['time'].concat(Object.keys(stats)));
            this.printHeader = false;
        }
        this.printFields([Date.now() - StatsLogger.startTime].concat(_.values(stats)));
    }
}

class MemWatcher extends StatsLogger
{
    constructor()
    {
        super('memory_stats.txt');
        
        memwatch.on('stats',
                    (stats: any): void => {
                        this.printStats(stats);
                    });
    }
    
}

class ServerWatcher extends StatsLogger
{
    connectionCount = 0;
    constructor(servers: http.Server[])
    {
        super('server_stats.txt');
        
        this.connectionCount = 0;
        
        servers.forEach((server: http.Server): void => {
            server.on('connection',
                      (socket: any): void => {
                        ++this.connectionCount;
                        this.printStats({ connections: this.connectionCount } );
                        socket.on('close',
                                  ((): void => {
                                    --this.connectionCount;
                                    this.printStats({ connections: this.connectionCount } );
                      }));
                });
        });     
    }
}

export class Generator 
{   
    memWatcher: MemWatcher;
    connectionWatcher: ServerWatcher;
    
    constructor(servers: http.Server[]) 
    {
       this.memWatcher = new MemWatcher();
       this.connectionWatcher = new ServerWatcher(servers);
    }
}
