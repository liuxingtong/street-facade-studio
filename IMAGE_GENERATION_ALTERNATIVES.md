# Alternative Image Generation APIs

If Doubao image quality is insufficient, consider these alternatives with easy API access:

## 1. **OpenAI DALL·E 3** (Recommended)
- **Quality**: Excellent, best for photorealistic and architectural edits
- **API**: `https://api.openai.com/v1/images/generations`
- **Auth**: `OPENAI_API_KEY`
- **Docs**: https://platform.openai.com/docs/guides/images
- **Image-to-image**: Via `image` parameter (base64 or URL)
- **Cost**: ~$0.04–0.08 per image (1024×1024)

## 2. **Replicate**
- **Models**: Flux, SDXL, Stable Diffusion, etc.
- **API**: `https://api.replicate.com/v1/predictions`
- **Auth**: `REPLICATE_API_TOKEN`
- **Docs**: https://replicate.com/docs
- **Popular models**: `black-forest-labs/flux-schnell`, `stability-ai/sdxl`
- **Cost**: Pay-per-second, typically $0.001–0.01 per image

## 3. **Fal.ai**
- **Models**: Flux, SDXL, Ideogram
- **API**: `https://fal.run/{model_id}`
- **Auth**: `FAL_KEY`
- **Docs**: https://fal.ai/docs
- **Cost**: Free tier available, then ~$0.01–0.05 per image

## 4. **Stability AI**
- **Models**: Stable Diffusion 3, SDXL
- **API**: `https://api.stability.ai/v1/generation/...`
- **Auth**: `STABILITY_API_KEY`
- **Docs**: https://platform.stability.ai/docs
- **Cost**: Credits-based

## 5. **Together AI**
- **Models**: Flux, SDXL
- **API**: `https://api.together.xyz/v1/images/generations`
- **Auth**: `TOGETHER_API_KEY`
- **Docs**: https://docs.together.ai/docs/image-generation

## Integration Notes

To switch from Doubao to another provider:
1. Add env vars (e.g. `OPENAI_API_KEY`)
2. Create a new API client in `src/api/` (e.g. `openai.ts`)
3. Update `App.tsx` to use the chosen provider via a config flag or env

OpenAI DALL·E 3 is the simplest drop-in for high quality; Replicate/Fal offer more model choices.
