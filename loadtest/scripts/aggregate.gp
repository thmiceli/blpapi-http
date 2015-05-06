set terminal pdfcairo
set output 'aggregate.pdf'
set ytics nomirror
set y2tics nomirror
set ylabel '(bytes)'
set y2label 'CPU usage (%)'
set xlabel 'time (s)'
plot 'process_stats.txt' every ::1 using ($1/1000):'memory' with lines title 'memory' axes x1y1, \
     'process_stats.txt' every ::1 using ($1/1000):'memoryInfo-cpu' smooth bezier title 'cpu' axes x1y2, \
     'gc_stats.txt' every ::1 using ($1/1000):'current_base' with lines title 'javascript mem' axes x1y1, \
     'server_stats.txt' every ::1 using ($1/1000):'bytesSent' with lines title 'Bytes sent' axes x1y1, \
     'server_stats.txt' every ::1 using ($1/1000):'bytesReceived' with lines title 'Bytes received' axes x1y1
unset output