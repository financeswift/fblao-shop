# Magpie MCP Server Setup Guide

This guide helps you connect the Magpie MCP Server to debug and manage Alipay/WeChat payments.

## Option 1: Claude Desktop (Recommended)

Add this to your Claude Desktop config file:

**macOS:** `~/Library/Application\ Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "magpie": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp.magpie.im/mcp"
      ]
    }
  }
}
```

Then restart Claude Desktop.

## Option 2: VS Code with MCP Extension

1. Install "MCP Client" extension in VS Code
2. Add to workspace settings `.vscode/settings.json`:

```json
{
  "mcpClient.servers": {
    "magpie": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp.magpie.im/mcp"
      ]
    }
  }
}
```

3. Reload VS Code

## Option 3: Node.js Server (This Project)

Add to `package.json` dependencies:

```bash
npm install mcp-remote
```

Then create `/mcp/magpie-client.js`:

```javascript
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { spawn } = require('child_process');

async function connectMagpieMCP() {
  const process = spawn('npx', ['mcp-remote', 'https://mcp.magpie.im/mcp']);
  const transport = new StdioClientTransport({ stdio: [process.stdin, process.stdout, process.stderr] });
  const client = new Client({ name: 'magpie-client', version: '1.0.0' }, { capabilities: {} });
  
  await client.connect(transport);
  console.log('Connected to Magpie MCP Server');
  
  // List available tools
  const tools = await client.listTools();
  console.log('Available Magpie tools:', tools);
  
  return client;
}

module.exports = { connectMagpieMCP };
```

## What You Can Do With Magpie MCP

The MCP Server provides 33 tools across:

- **Payments** — Process Alipay/WeChat payments
- **Checkouts** — Create and verify payment sessions
- **Invoices** — Generate payment invoices
- **Payment Links** — Create shareable payment links
- **Status Queries** — Check payment status
- **Refunds** — Process refunds

## Using MCP to Debug Alipay/WeChat Issues

In Claude Desktop or MCP client, you can now:

1. **Check Magpie Configuration**
   ```
   "What's the status of my Alipay payments in Magpie?"
   ```

2. **Test Payment Creation**
   ```
   "Create a test Alipay payment for 100 CNY"
   ```

3. **Verify Webhooks**
   ```
   "Check if my Magpie webhook is working"
   ```

4. **Query Order Status**
   ```
   "What's the status of order XXXX for Alipay?"
   ```

5. **Debug API Credentials**
   ```
   "Verify my Magpie API key is valid"
   ```

## Troubleshooting

**Connection fails?**
- Ensure Node 18+ is installed
- Check internet connection
- Try: `npx mcp-remote https://mcp.magpie.im/mcp`

**401 errors on Alipay/WeChat?**
- Use MCP to verify API credentials
- Check if keys are for correct environment (sandbox vs live)
- Confirm currency conversion settings

**Webhooks not firing?**
- Use MCP to test webhook delivery
- Verify webhook URL is correct and publicly accessible
- Check Magpie dashboard for failed webhook logs

## Next Steps

1. **Connect MCP Server** — Choose option 1, 2, or 3 above
2. **Test Connection** — Ask "List Magpie payment tools"
3. **Debug Issues** — Use natural language to troubleshoot
4. **Process Payments** — Use MCP tools to test/verify Alipay/WeChat

---

**Resources:**
- Magpie MCP Docs: https://mcp.magpie.im/
- Magpie API Docs: https://api.magpie.im/docs
- MCP Protocol: https://modelcontextprotocol.io/
