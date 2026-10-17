package server

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"syscall"
)

type IPFamily string

const (
	IPAuto IPFamily = "auto"
	IPv4   IPFamily = "ipv4"
	IPv6   IPFamily = "ipv6"
)

func listenIP(addr string, family IPFamily) ([]net.Listener, error) {
	if family == "" {
		family = IPAuto
	}
	if family != IPAuto && family != IPv4 && family != IPv6 {
		return nil, fmt.Errorf("ip_family must be auto, ipv4, or ipv6")
	}
	if addr == "" {
		addr = ":http"
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	var targets []net.IP
	local := host == "" || strings.EqualFold(host, "localhost")
	if local {
		if host == "" {
			targets = []net.IP{net.IPv4zero, net.IPv6zero}
		} else {
			targets = []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback}
		}
	} else if ip := net.ParseIP(host); ip != nil {
		if (family == IPv4 && ip.To4() == nil) || (family == IPv6 && ip.To4() != nil) {
			return nil, fmt.Errorf("address %s conflicts with ip_family=%s", host, family)
		}
		targets = []net.IP{ip}
	} else {
		targets, err = net.LookupIP(host)
		if err != nil {
			return nil, err
		}
	}
	listeners := []net.Listener{}
	fail := func(cause error) ([]net.Listener, error) {
		for _, listener := range listeners {
			listener.Close()
		}
		return nil, cause
	}
	seen := make(map[string]bool, len(targets))
	for _, ip := range targets {
		if seen[ip.String()] {
			continue
		}
		seen[ip.String()] = true
		is4 := ip.To4() != nil
		if (family == IPv4 && !is4) || (family == IPv6 && is4) {
			continue
		}
		network := "tcp6"
		if is4 {
			network = "tcp4"
		}
		listener, err := net.Listen(network, net.JoinHostPort(ip.String(), port))
		if err != nil {
			if family == IPAuto && local && (errors.Is(err, syscall.EAFNOSUPPORT) || errors.Is(err, syscall.EPROTONOSUPPORT) || errors.Is(err, syscall.EADDRNOTAVAIL)) {
				continue
			}
			return fail(err)
		}
		listeners = append(listeners, listener)
		port = strconv.Itoa(listener.Addr().(*net.TCPAddr).Port)
	}
	if len(listeners) == 0 {
		return fail(fmt.Errorf("no available %s listen address for %s", family, host))
	}
	return listeners, nil
}
