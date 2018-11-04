FROM node:alpine

# Set up app space
COPY bootstrap.js package.json package-blacklist.json package-whitelist.json /app/
WORKDIR /app
RUN npm install

CMD ["npm", "start"]
