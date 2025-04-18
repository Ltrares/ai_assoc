# Using Anthropic's Claude Code
*By Luke Trares*  
[linkedin.com/in/luke-trares-720b304](https://linkedin.com/in/luke-trares-720b304)  
*April, 2025*

## Introduction

I've spent some time using Claude Code by Anthropic ([https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)) to develop a complete simple application.

You can find the results here:  
[https://ai-association-game-227eb30056bb.herokuapp.com/](https://ai-association-game-227eb30056bb.herokuapp.com/)

For a small amount of money and time you can make something very similar to something that actually works, without writing a single line of code.

For a good bit more money and time, you can keep refining it and debugging it until it actually works. Completing something this way will test your patience and your wallet.

## Key Takeaways

- Claude Code is currently in experimental beta release - they're releasing changes all the time, sometimes multiple times per day.
- Claude Code can get you up and running really quickly. I set up an express-node-react client and server in seconds for $0.23.
- For complex tasks, you should probably do it yourself and just ask Claude AI or Claude Code to make unit tests and documentation.
- If you're coding for a hobby - do NOT use Claude Code extensively. It's just too expensive. Instead, use the "GitHub" app feature of the normal Claude AI chat portal or other AI code assist tools that are based on a subscription.
- Claude Code is usually very good at analyzing existing code and making small changes.
- Creating entirely new complex features is hit or miss – often a big miss. The concept shows promise but needs a lot more work.
- The kinds of errors Claude Code makes are really the same kinds of errors humans make. Claude Code makes them much faster.
- I struggled to get Claude Code to use its memory file (CLAUDE.md) effectively - so I had to repeat myself over and over and over.

## Is it worth it?

**Short answer:** I'm not sure. I definitely can use Claude AI chat interface to help with small tasks, documentation and testing. I'm not sure I need Claude Code too.

I'd like to see a large scale, independent study to objectively compare developer performance with and without Claude Code - is it worth the money to pay a developer and to pay Anthropic for an expensive development aid?

One of my biggest concerns was that Claude Code would create fallbacks for failing code – it tended to hide errors instead of solving them.

I saw similar results developing tests. Claude Code would keep adjusting the test until it passed. However, this created ineffective tests. I often had to prompt it, saying, "That seems like a bug in the source code, let's fix that."

If you are working on a hobby project that you do not intend to monetize then Claude Code is definitely not worth the "/cost".  ("/cost" is the command to show your spend for the current session – it goes up fast.)

If you are making something really simple like a basic chat app, you might be able to hit the ground running for as little as one dollar.

With anything more complex (like a simple game or an interactive data visualization), you need to be prepared to spend time making sure Claude Code does it right and money to pay for Claude Code to do it wrong many times before getting it right. Supervising Claude Code takes a lot of effort.

## Conclusions

- **Suitable for professional use?** Probably not without it being custom trained and extensively tested. It's too unreliable.
- **Replacing developers?** Not yet but it can help in many scenarios.
- **Replacing testers?** Not yet, but again, it can help.
- **Replacing engineers?** Not yet - and maybe not for a long time. Reliable, insightful synthesis and complex problem solving just don't seem to be ready.

One experiment I'd like to run would be to create a unit test suite and see how well Claude Code develops the code for it using different prompts. I say, "I'd like to run" this experiment because the iterative testing process gets expensive very quickly, especially on a larger code base (more code = more tokens). Being able to do this well would free me to supervise less.

I'm also interested in the idea of "helping developers do their job faster and better." I think, with a lot of training and improvement, Claude Code can do that. However, I don't see it replacing anyone in the short term, maybe not even in the long term. I think we should focus on real, measurable productivity improvements.

---

*BTW - Claude/Claude Code generated the MIDI music for the demo app. Creating music using Claude Code was a lot like writing code with Claude Code: intriguing, promising and a bit exasperating.*