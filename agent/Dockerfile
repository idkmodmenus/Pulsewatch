# Optional container image for the agent; most deployments will run it directly with
# `node src/agent.js` on the host instead. No external dependencies.
FROM node:20-alpine
WORKDIR /app
COPY src ./src
COPY package.json ./
ENV PULSEWATCH_URL=""
ENV PULSEWATCH_TOKEN=""
CMD ["node", "src/agent.js"]
