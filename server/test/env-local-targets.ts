// Variant used by tests that spin up a listener on 127.0.0.1. Rather than disabling the SSRF
// guard entirely (which would defeat the tests that check it), this allowlists only the
// loopback test server's own address, so 169.254.169.254, other loopback addresses, etc.
// are still correctly rejected.
process.env.ALLOWED_PRIVATE_CIDRS = '127.0.0.1/32';
process.env.DNS_CACHE_TTL_MS = '0';
import './env.js';
