import Anthropic from "@anthropic-ai/sdk";

const { ANTHROPIC_API_KEY } = process.env;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY});




export const callClaude = async (query: string, sys: string) => {
  const msg = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1000,
    temperature: 0,
    system: sys,
    messages: [
        {
        "role": "user",
        "content": [
            {
            "type": "text",
            "text": query
            }
        ]
        }
    ]
    });

    console.log(msg);
    // @ts-ignore
    return msg.content[0].text;
}



