# Verifying Your Configuration

The verification pipeline checks 7 aspects of your endpoint:

1. ✅ **DNS Resolution** — Can the hostname be resolved?
2. ✅ **TLS Certificate** — Is the certificate valid?
3. ✅ **Endpoint Reachability** — Is the server responding?
4. ✅ **Health Check** — Does /health report healthy?
5. ✅ **Model List** — Are models available?
6. ✅ **Dialect Validation** — Does the response format match?
7. ✅ **Test Prompt** — Can a simple prompt be completed? (optional)

Each step provides actionable error messages if something goes wrong.
