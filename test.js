const test = require('brittle')
const { PassThrough } = require('bare-stream')
const RPC = require('.')

test('basic', async (t) => {
  const rpc = new RPC(new PassThrough(), (req) => {
    t.is(req.command, 'heartbeat')
    t.alike(req.data, Buffer.from('ping'))

    req.reply('pong')
  })

  const req = rpc.request('heartbeat')
  req.send('ping')

  t.alike(await req.reply(), Buffer.from('pong'))
})
