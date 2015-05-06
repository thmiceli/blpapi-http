set terminal pdfcairo
set output 'gc.pdf'
plot 'gc_stats.txt' every ::1 using ($1/1000):'current base' with lines, \
     'gc_stats.txt' every ::1 using ($1/1000):'estimated base' with lines
unset output