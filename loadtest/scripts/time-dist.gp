# usage: gnuplot -e "filename='<datafile>'" <this file>
set terminal pdfcairo
set output 'out.pdf'
set datafile separator ","
set boxwidth 5
binwidth = 5
bin(val) = binwidth * floor(val/binwidth)
plot filename using (bin(column(2))):(1.0) smooth frequency title filename with boxes
unset output