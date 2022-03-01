# Moa Clay Collection

## Development

From your terminal:

```sh
yarn  dev
```

create images

```
convert -thumbnail 700x -quality 90 IMG_3720.HEIC 3720_thumb.jpg
```

## Stage

From your terminal:

```sh
yarn build
./node_modules/vercel/dist/index.js
./node_modules/vercel/dist/index.js alias `build` stage.moaclayco.com
```

## Production

From your terminal:

```sh
yarn build
./node_modules/vercel/dist/index.js --prod
```