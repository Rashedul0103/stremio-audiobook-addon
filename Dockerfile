FROM node:18-alpine

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Hugging Face runs with UID 1000 (the built-in 'node' user)
RUN chown -R node:node /app
USER node

# Hugging Face Spaces routes web traffic to port 7860
ENV PORT=7860
EXPOSE 7860

CMD ["node", "src/index.js"]
