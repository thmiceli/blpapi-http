#!/bin/bash
#usage: bench.sh <number of requests> <concurrency level>
NB_REQUEST=$1
CONCURRENCY=$2
BASE_NAME=req-resp-$1-$2
DATA_FILE=data/$BASE_NAME.csv
REPORT_FILE=reports/$BASE_NAME.pdf

mkdir -p data
mkdir -p reports

ab -n $NB_REQUEST -c $CONCURRENCY -e $DATA_FILE -l -k -p 'postdata.txt' "http://localhost:3000/request?ns=blp&service=refdata&type=HistoricalDataRequest"

gnuplot -e "filename='$DATA_FILE'" time-dist.gp
mv 'out.pdf' $REPORT_FILE
    
