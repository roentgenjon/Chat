FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm install -g ts-node typescript
EXPOSE 3000
CMD ["npm", "start"]
