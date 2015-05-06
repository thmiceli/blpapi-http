set terminal pdfcairo
set output 'process.pdf'
set ytics nomirror
set y2tics nomirror
set ylabel 'Memory (bytes)'
set y2label 'CPU usage (%)'
set xlabel 'time (s)'
plot 'process_stats.txt' every ::1 using ($1/1000):'memoryInfo-rss' with lines title 'rss' axes x1y1, \
     'process_stats.txt' every ::1 using ($1/1000):'memoryInfo-vsize' with lines title 'vsize' axes x1y1, \
     'process_stats.txt' every ::1 using ($1/1000):'memoryInfo-cpu' with lines title 'cpu' axes x1y2

unset output