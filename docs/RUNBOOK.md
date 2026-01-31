# Runbook

Operational procedures for openclaw-dingtalk channel plugin.

## Deployment

### Prerequisites

1. DingTalk application configured with:
   - Robot capability enabled
   - Stream mode selected (NOT HTTP mode)
   - Application published (at least test version)

2. Required permissions:
   - `Card.Streaming.Write` (for AI Card)
   - `Card.Instance.Write` (for AI Card)
   - Robot message receive permission

### Installation

```bash
# Via OpenClaw CLI
openclaw plugins install @adongguo/dingtalk

# Via npm
npm install @adongguo/dingtalk
```

### Configuration

```bash
# Minimum required configuration
openclaw config set channels.dingtalk.appKey "dingXXXXXXXX"
openclaw config set channels.dingtalk.appSecret "your_app_secret"
openclaw config set channels.dingtalk.enabled true

# Optional: Gateway integration
openclaw config set channels.dingtalk.gatewayToken "your_gateway_token"
openclaw config set channels.dingtalk.gatewayPort 18789
```

### Verification

```bash
# Start OpenClaw
openclaw start

# Expected log output:
# dingtalk: starting Stream connection...
# dingtalk: Stream client connected
```

## Monitoring

### Health Indicators

| Indicator | Healthy | Unhealthy |
|-----------|---------|-----------|
| Stream connection | `Stream client connected` | Connection errors in logs |
| Message receive | Messages logged with sender info | No message logs |
| Message send | Replies appear in DingTalk | `sessionWebhook` errors |

### Log Patterns

**Successful message flow:**
```
dingtalk: received message from [user] ([staffId]) in [conversationId] (p2p)
dingtalk: dispatching to agent (session=...)
dingtalk: sent reply via sessionWebhook
```

**Connection issues:**
```
dingtalk: Stream connection error: ...
dingtalk: reconnecting...
```

**Rate limiting:**
```
dingtalk: rate limited, waiting...
```

### Metrics to Monitor

- Stream connection uptime
- Message receive rate
- Reply success rate
- sessionWebhook expiration events
- AI Card creation success rate

## Common Issues

### Issue: Bot receives no messages

**Symptoms:**
- No message logs in OpenClaw
- Users report bot not responding

**Diagnosis:**
1. Check Stream mode is enabled (not HTTP mode)
2. Verify application is published
3. Confirm appKey/appSecret are correct

**Resolution:**
```bash
# Verify configuration
openclaw config get channels.dingtalk

# Check DingTalk Open Platform:
# 1. Application → Robot → Verify "Stream mode" is selected
# 2. Publish application if in draft state
# 3. Re-copy appKey/appSecret from Basic Information
```

### Issue: Failed to send messages

**Symptoms:**
- Messages received but no reply sent
- `sessionWebhook` errors in logs

**Diagnosis:**
1. Check if sessionWebhook has expired
2. Verify message format
3. Check rate limiting

**Resolution:**
```bash
# Add cooldown to avoid rate limiting
openclaw config set channels.dingtalk.cooldownMs 1000

# Check logs for specific error:
# - "sessionWebhook expired" → Normal, DingTalk limitation
# - "rate limited" → Increase cooldownMs
# - "invalid message format" → Check renderMode setting
```

### Issue: AI Card not working

**Symptoms:**
- Messages sent as plain text instead of AI Card
- AI Card creation errors in logs

**Diagnosis:**
1. Check AI Card permissions
2. Verify aiCardMode is enabled

**Resolution:**
```bash
# Verify AI Card mode
openclaw config get channels.dingtalk.aiCardMode

# Check DingTalk permissions:
# Application → Permissions → Add Card.Streaming.Write, Card.Instance.Write

# Fallback to regular messages
openclaw config set channels.dingtalk.aiCardMode "disabled"
```

### Issue: Connection keeps dropping

**Symptoms:**
- Frequent `reconnecting...` logs
- Intermittent message delivery

**Diagnosis:**
1. Check network connectivity
2. Verify DingTalk platform status
3. Check for credential issues

**Resolution:**
```bash
# The SDK auto-reconnects, but if persistent:
# 1. Restart OpenClaw
# 2. Re-verify credentials
# 3. Check DingTalk platform status at https://open.dingtalk.com
```

### Issue: Media upload fails

**Symptoms:**
- Images not sent
- `media upload failed` errors

**Diagnosis:**
1. Verify robotCode is configured
2. Check media size limits
3. Verify file permissions

**Resolution:**
```bash
# Configure robotCode (same as appKey usually)
openclaw config set channels.dingtalk.robotCode "dingXXXXXXXX"

# Adjust media size limit
openclaw config set channels.dingtalk.mediaMaxMb 50
```

## Rollback Procedures

### Plugin Version Rollback

```bash
# Uninstall current version
openclaw plugins uninstall @adongguo/dingtalk

# Install specific version
npm install @adongguo/dingtalk@0.1.2
```

### Configuration Rollback

```bash
# Disable channel
openclaw config set channels.dingtalk.enabled false

# Reset to defaults
openclaw config delete channels.dingtalk
openclaw config set channels.dingtalk.appKey "..."
openclaw config set channels.dingtalk.appSecret "..."
openclaw config set channels.dingtalk.enabled true
```

### Emergency Disable

```bash
# Immediately disable channel
openclaw config set channels.dingtalk.enabled false

# Or via config file, set:
# channels.dingtalk.enabled: false
```

## Maintenance

### Credential Rotation

1. Generate new appSecret in DingTalk Open Platform
2. Update configuration:
   ```bash
   openclaw config set channels.dingtalk.appSecret "new_secret"
   ```
3. Restart OpenClaw
4. Verify connectivity

### Version Upgrade

1. Check release notes for breaking changes
2. Backup configuration
3. Install new version:
   ```bash
   npm install @adongguo/dingtalk@latest
   ```
4. Restart OpenClaw
5. Verify functionality

## DingTalk API Limitations

| Feature | Support | Notes |
|---------|---------|-------|
| Message editing | No | Cannot edit sent messages |
| Reactions | No | Bot API doesn't support reactions |
| Typing indicator | No | No native API |
| sessionWebhook | Temporary | Expires after ~24 hours |
| Rate limits | Yes | Avoid rapid message sending |

## Support Resources

- [DingTalk Developer Portal](https://open-dev.dingtalk.com)
- [DingTalk API Documentation](https://open.dingtalk.com/document)
- [Plugin Issues](https://github.com/adongguo/openclaw-dingtalk/issues)
- [Stream SDK Docs](https://opensource.dingtalk.com/developerpedia/docs/learn/stream/overview)
