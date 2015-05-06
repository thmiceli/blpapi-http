declare module "usage" {
    module usage {
      function lookup(pid: number,
                      options: any,
                      callback: (err: Error,
                                 result: any) => void): void;
      
      function clearHistory(pid: number): void;                                 
    }
    export = usage;
}

