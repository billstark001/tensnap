module github.com/billstark001/tensnap/examples/go/benchmarks/schelling-v1

go 1.22

require github.com/billstark001/tensnap/examples/go v0.0.0

require (
	github.com/billstark001/tensnap/packages/tensnap-go v0.0.0 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/vmihailenco/msgpack/v5 v5.4.1 // indirect
	github.com/vmihailenco/tagparser/v2 v2.0.0 // indirect
)

replace github.com/billstark001/tensnap/examples/go => ../../../../../examples/go

replace github.com/billstark001/tensnap/packages/tensnap-go => ../../../../../packages/tensnap-go
