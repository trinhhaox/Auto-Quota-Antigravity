# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in Auto-Quota-Antigravity, please **do not** open a public GitHub issue. Instead, please follow these steps:

### Reporting Process

1. **Email**: Send a detailed report to [security contact]
2. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Initial Response**: Within 24-48 hours
- **Assessment**: Within 1 week
- **Fix & Release**: ASAP (typically within 2 weeks)
- **Disclosure**: After patch is released

## Security Best Practices for Users

### Credentials & Secrets

- ✅ Store API keys in `~/.claude/.credentials.json` or system Keychain
- ✅ Use OAuth tokens instead of API keys
- ❌ Never hardcode secrets in configuration files
- ❌ Never commit `.env` or credential files

### Extension Security

- ✅ Keep VS Code and extensions updated
- ✅ Review extension permissions before install
- ✅ Monitor automation rules settings
- ✅ Disable unused automation features

### Network Security

- ✅ Use HTTPS for all API communications
- ✅ Bearer tokens are validated on every request
- ✅ Local HTTP bridge uses cryptographic tokens

## Known Security Considerations

### OAuth Token Handling

- Tokens are stored in system secure storage (Keychain/Credentials)
- Tokens are only transmitted over HTTPS
- Token expiration is checked before use

### Automation Bridge

- Requires cryptographic token on every HTTP request
- Uses localhost (127.0.0.1) only
- Disables CORS for security

## Security Updates

We monitor and respond to:

- Dependency vulnerabilities (via Dependabot)
- Code vulnerabilities (via CodeQL & SEMGREP)
- Secret leaks (via Gitleaks & TruffleHog)

## Dependency Management

All dependencies are regularly audited:
- `npm audit` runs on every pull request
- Dependabot checks for updates weekly
- Security patches are prioritized

## Compliance

This project follows:
- OWASP Top 10 security practices
- GitHub security best practices
- Node.js security guidelines
