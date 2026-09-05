# Multiplayer arena

The Mirage showcase for [`@vapour/net`](../../docs/multiplayer.md). Like the
[physics sandbox](../physics-sandbox/), its job is to prove the systems compose
**under conditions that matter** — a real network with latency, jitter, loss and
reordering — rather than to be a game.

```sh
pnpm --filter @vapour/example-multiplayer-arena run
```

```
Multiplayer arena — authoritative, predicted, under load

  conditions       80ms +/- 40ms, 15% loss, 8% reorder
  players          6
  simulated        10 s at 20 Hz (200 ticks)
  shots fired      92
  hits             2
  bandwidth        776.9 KB total, 13259 B/s per client
  packets dropped  497 of 4430
  worst drift      0.899 world units
  mispredictions   169
  wall clock       85 ms
```

**Worst drift under 0.9 world units** while a fifth of all packets are being
dropped. That number is the whole claim: prediction tracks the server rather
than diverging from it, and a dropped snapshot is superseded by the next.

## The shape it demonstrates

**Clients send inputs; the server decides.** A client never says where it is, it
says which keys are down. That is the only arrangement in which a modified
client cannot teleport or shoot through walls — and the tests check it: a client
sending a movement vector of length ten moves at exactly normal speed, because
`stepPlayer` normalizes rather than trusting.

**One movement function, imported by both sides.** Prediction is only correct if
the client's guess and the server's truth are computed identically. Two copies
of that logic would diverge and show up as constant mispredictions, so there is
deliberately one `stepPlayer`.

**The local player is predicted; everyone else is interpolated.** `self()`
returns the predicted state, `others()` the interpolated one. Predicting remote
players makes them jitter on every packet.

**Scoring, damage, and respawn are server-side.** A client reporting its own
kills is a client reporting whatever it likes.

## About the numbers

**13 KB/s per client** is with *no interest management*, which is correct here:
in an arena everyone should see everyone. That figure scales linearly with
player count, which is exactly why
[interest filtering](../../docs/multiplayer.md#bandwidth) exists for larger
worlds — it takes the same scene from 9,661 to 875 bytes per tick per client.

**169 mispredictions** across six clients over 200 ticks is roughly 14% — close
to the 15% packet loss, which is what you would expect: each dropped snapshot
means one tick where the client's guess is not confirmed.

## Tests

`arena.test.ts` covers the composition: that prediction applies before the
server has seen the input, that it converges on the server's truth under
latency, that a leaving player's avatar despawns for everyone, and that clients
stay converged through jitter, loss, and reordering.
