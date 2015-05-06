set terminal pdfcairo
set output 'server.pdf'
#plot 'server_stats.txt' every ::1 using 'connections' with boxes axes x1y1, \
#     'server_stats.txt' every ::1 using 'bytesSent' with lines axes x1y2, \
#     'server_stats.txt' every ::1 using 'bytesReceived' with lines axes x1y2
plot 'server_stats.txt' every ::1 using 'bytesSent' with lines axes x1y2, \
     'server_stats.txt' every ::1 using 'bytesReceived' with lines axes x1y2     
unset output