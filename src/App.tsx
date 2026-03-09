/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { doubaoImageGenerate } from './api/doubao';
import { sam2SegmentMasks, sam2SegmentAtPoint, sam2ColorRichnessFull, type MaskItem } from './api/sam2';
import { exportToXlsx } from './utils/exportXlsx';
import { 
  Upload, 
  Zap, 
  Layers, 
  Maximize2, 
  Store, 
  RefreshCw, 
  Image as ImageIcon,
  Loader2,
  Download,
  Check,
  FileSpreadsheet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ColorRawVars {
  HueEntropy: number;
  SaturationMean: number;
  HueDiversity: number;
  NonzeroBins: number;
}

interface FacadeMetrics {
  Transparency: number;
  SignageScale: number;
  ColorRichness: number;
  ColorRichnessRaw?: number;
  ColorRawVars?: ColorRawVars;
  HueHistogram?: number[];
  StyleDescription: string;
  Reasoning: string;
  segmentationImageUrl?: string;
}

interface GenerationResult {
  id: string;
  imageUrl: string;
  metrics: { transparency: number; signage: number; color: number };
  prompt?: string;
  model?: string;
  seed?: number;
  timestamp?: string;
}

export default function App() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [metrics, setMetrics] = useState<FacadeMetrics | null>(null);
  const [segmentMasks, setSegmentMasks] = useState<{ masks: MaskItem[]; width: number; height: number } | null>(null);
  const [maskLabels, setMaskLabels] = useState<Record<number, 'glass' | 'signboard'>>({});
  const [labelMode, setLabelMode] = useState<'glass' | 'signboard' | null>(null);
  const [annotatedOverlayUrl, setAnnotatedOverlayUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generations, setGenerations] = useState<GenerationResult[]>([]);
  const [activeTab, setActiveTab] = useState<'analysis' | 'generation'>('analysis');
  const [customPrompt, setCustomPrompt] = useState('');
  const [lastAnalysisTimestamp, setLastAnalysisTimestamp] = useState<string | null>(null);
  const [lastGenerationMeta, setLastGenerationMeta] = useState<{ prompt: string; model: string; seed: number; timestamp: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setSelectedImage(result);
        setMetrics(null);
        setSegmentMasks(null);
        setMaskLabels({});
        setLabelMode(null);
        setAnnotatedOverlayUrl(null);
        setGenerations([]);
        setActiveTab('analysis');
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const getDoubaoConfig = () => {
    const singleEp = process.env.DOUBAO_ENDPOINT?.trim();
    const chatEp = process.env.DOUBAO_CHAT_ENDPOINT?.trim();
    const imageEp = process.env.DOUBAO_IMAGE_ENDPOINT?.trim();
    const ep = singleEp || chatEp || imageEp;
    if (!ep) return null;
    return {
      apiKey: '',
      chatEndpoint: singleEp || chatEp || ep || '',
      imageEndpoint: singleEp || imageEp || ep || '',
    };
  };

  const startDirectLabeling = () => {
    if (!selectedImage) return;
    const img = new Image();
    img.onload = () => {
      setSegmentMasks({ masks: [], width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = selectedImage;
  };

  const nextIdRef = useRef(0);
  const handleAddMaskAtPoint = async (x: number, y: number) => {
    if (!selectedImage || !segmentMasks) return;
    setIsAnalyzing(true);
    try {
      const res = await sam2SegmentAtPoint(selectedImage, x, y);
      if (res.mask) {
        setSegmentMasks((prev) => {
          if (!prev) return prev;
          const nextId = prev.masks.length > 0
            ? Math.max(...prev.masks.map((m) => m.id)) + 1
            : 0;
          nextIdRef.current = nextId;
          return {
            ...prev,
            masks: [...prev.masks, { ...res.mask!, id: nextId }],
          };
        });
        if (labelMode) {
          setMaskLabels((prev) => ({ ...prev, [nextIdRef.current]: labelMode }));
        }
      } else {
        alert('未能分割该区域，请尝试点击其他位置');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('分割失败: ' + msg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleMaskClick = (maskId: number) => {
    if (!labelMode) return;
    const current = maskLabels[maskId];
    if (current === labelMode) {
      setMaskLabel(maskId, null);
    } else {
      setMaskLabel(maskId, labelMode);
    }
  };

  const runSegmentMasks = async () => {
    if (!selectedImage) return;
    setIsAnalyzing(true);
    setMetrics(null);
    setSegmentMasks(null);
    setMaskLabels({});
    setLabelMode(null);
    setAnnotatedOverlayUrl(null);
    try {
      const result = await sam2SegmentMasks(selectedImage);
      setSegmentMasks(result);
    } catch (error: unknown) {
      console.error("Segment failed:", error);
      let msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('fetch') || msg.includes('Failed to fetch')) {
        msg = 'Cannot connect to segmentation service. Run: npm run sam2 (or cd sam2_server && python -m uvicorn app:app --port 3002)';
      }
      alert("分割失败: " + (msg || "Check SAM2 service."));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const buildAnnotatedOverlay = (imgUrl: string, masks: MaskItem[], labels: Record<number, 'glass' | 'signboard'>) => {
    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('No canvas context'));
        ctx.drawImage(img, 0, 0);
        const totalArea = img.width * img.height;
        const scaleX = img.width / (segmentMasks?.width ?? img.width);
        const scaleY = img.height / (segmentMasks?.height ?? img.height);
        masks.forEach((m) => {
          const label = labels[m.id];
          const color = label === 'glass' ? 'rgba(30, 144, 255, 0.6)' : label === 'signboard' ? 'rgba(220, 53, 69, 0.6)' : 'rgba(128, 128, 128, 0.4)';
          ctx.fillStyle = color;
          ctx.beginPath();
          const pts = m.polygon.map(([x, y]) => [x * scaleX, y * scaleY] as [number, number]);
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.closePath();
          ctx.fill();
        });
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = imgUrl;
    });
  };

  const confirmCompute = async () => {
    if (!selectedImage || !segmentMasks) return;
    const glassIds = Object.entries(maskLabels).filter(([, v]) => v === 'glass').map(([k]) => Number(k));
    const signboardIds = Object.entries(maskLabels).filter(([, v]) => v === 'signboard').map(([k]) => Number(k));
    const totalArea = segmentMasks.width * segmentMasks.height;
    const glassPixels = segmentMasks.masks.filter((m) => glassIds.includes(m.id)).reduce((s, m) => s + m.area, 0);
    const signboardPixels = segmentMasks.masks.filter((m) => signboardIds.includes(m.id)).reduce((s, m) => s + m.area, 0);
    const transparency = Math.min(100, Math.round((glassPixels / totalArea) * 100));
    const signageRatio = signboardPixels / totalArea;
    const signageScale = Math.min(100, Math.round(signageRatio * 100 * 3));
    let colorRichness = 0;
    let colorRichnessRaw = 0;
    let colorRawVars: ColorRawVars | undefined;
    try {
      const crData = await sam2ColorRichnessFull(selectedImage);
      colorRichness = crData.ColorRichness;
      colorRichnessRaw = crData.ColorRichnessRaw;
      colorRawVars = crData.ColorRawVars;
    } catch (e) {
      console.warn('Color richness failed:', e);
    }
    const overlayUrl = await buildAnnotatedOverlay(selectedImage, segmentMasks.masks, maskLabels);
    setAnnotatedOverlayUrl(overlayUrl);
    setMetrics({
      Transparency: transparency,
      SignageScale: signageScale,
      ColorRichness: colorRichness,
      ColorRichnessRaw: colorRichnessRaw,
      ColorRawVars: colorRawVars,
      HueHistogram: [],
      StyleDescription: 'Manual labeling via SAM2 segmentation',
      Reasoning: `User labeled ${glassIds.length} glass / ${signboardIds.length} signboard regions.`,
    });
    setLastAnalysisTimestamp(new Date().toISOString());
      setActiveTab('analysis');
  };

  const downloadImage = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const setMaskLabel = (maskId: number, label: 'glass' | 'signboard' | null) => {
    setMaskLabels((prev) => {
      const next = { ...prev };
      if (label) next[maskId] = label;
      else delete next[maskId];
      return next;
    });
  };

  const generateFromPrompt = async () => {
    if (!selectedImage || !customPrompt.trim()) {
      alert('Upload an image and enter a prompt first.');
      return;
    }
    const config = getDoubaoConfig();
    if (!config || !config.imageEndpoint) {
      alert('Configure DOUBAO_API_KEY and DOUBAO_IMAGE_ENDPOINT in .env');
      return;
    }
    setIsGenerating(true);
    try {
      const { imageUrl, seed } = await doubaoImageGenerate(config, customPrompt.trim(), { image: selectedImage });
      const ts = new Date().toISOString();
      setLastGenerationMeta({ prompt: customPrompt.trim(), model: config.imageEndpoint, seed, timestamp: ts });
      setSelectedImage(imageUrl);
      setMetrics(null);
      setSegmentMasks(null);
      setMaskLabels({});
      setLabelMode(null);
      setAnnotatedOverlayUrl(null);
      setActiveTab('analysis');
      // 生成后自动触发 SAM2 分割
      setIsAnalyzing(true);
      try {
        const result = await sam2SegmentMasks(imageUrl);
        setSegmentMasks(result);
      } catch (e) {
        console.error('Auto-segment after generate failed:', e);
      } finally {
        setIsAnalyzing(false);
      }
    } catch (error: unknown) {
      console.error('Prompt generation failed:', error);
      alert('Generation failed: ' + (error instanceof Error ? error.message : 'Please retry.'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportXlsx = async () => {
    const imageToExport = generations.length > 0 ? generations[0].imageUrl : selectedImage;
    if (!imageToExport) {
      alert('No image to export. Upload and analyze first.');
      return;
    }
    const timestamp = lastGenerationMeta?.timestamp ?? lastAnalysisTimestamp ?? new Date().toISOString();
    let metricsToExport: { Transparency: number; SignageScale: number; ColorRichness: number; ColorRichnessRaw?: number; ColorRawVars?: ColorRawVars } | undefined = metrics
      ? { Transparency: metrics.Transparency, SignageScale: metrics.SignageScale, ColorRichness: metrics.ColorRichness, ColorRichnessRaw: metrics.ColorRichnessRaw, ColorRawVars: metrics.ColorRawVars }
      : generations[0]
        ? { Transparency: generations[0].metrics.transparency, SignageScale: generations[0].metrics.signage, ColorRichness: generations[0].metrics.color }
        : undefined;
    try {
      const crData = await sam2ColorRichnessFull(imageToExport);
      if (metricsToExport) {
        metricsToExport = {
          Transparency: metricsToExport.Transparency,
          SignageScale: metricsToExport.SignageScale,
          ColorRichness: metricsToExport.ColorRichness ?? crData.ColorRichness,
          ColorRichnessRaw: crData.ColorRichnessRaw,
          ColorRawVars: crData.ColorRawVars,
        };
      } else {
        metricsToExport = {
          Transparency: 0,
          SignageScale: 0,
          ColorRichness: crData.ColorRichness,
          ColorRichnessRaw: crData.ColorRichnessRaw,
          ColorRawVars: crData.ColorRawVars,
        };
      }
    } catch (e) {
      console.warn('Could not fetch ColorRawVars for export:', e);
    }
    await exportToXlsx({
      imageDataUrl: imageToExport,
      segmentationImageUrl: annotatedOverlayUrl ?? undefined,
      timestamp,
      metrics: metricsToExport ?? undefined,
      generation: lastGenerationMeta ?? undefined,
    });
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Header */}
      <header className="border-b border-[#141414] p-6 flex justify-between items-center bg-white/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#141414] rounded-full flex items-center justify-center text-white">
            <Layers size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight uppercase">Facade Studio</h1>
            <p className="text-[10px] font-mono opacity-50 uppercase tracking-widest">Interface Transparency Analysis & Design</p>
          </div>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => {
              setSelectedImage(null);
              setMetrics(null);
              setSegmentMasks(null);
              setMaskLabels({});
              setLabelMode(null);
              setAnnotatedOverlayUrl(null);
              setGenerations([]);
              setLastAnalysisTimestamp(null);
              setLastGenerationMeta(null);
              setActiveTab('analysis');
            }}
            className="px-4 py-2 border border-[#141414]/20 rounded-full text-sm font-medium hover:bg-red-50 transition-all flex items-center gap-2"
          >
            <RefreshCw size={16} />
            Reset
          </button>
          <button 
            onClick={handleExportXlsx}
            disabled={!selectedImage && generations.length === 0}
            className="px-4 py-2 border border-[#141414]/20 rounded-full text-sm font-medium hover:bg-[#141414]/5 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Export to xlsx (image, metrics, prompt, model, seed)"
          >
            <FileSpreadsheet size={16} />
            Export xlsx
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 border border-[#141414] rounded-full text-sm font-medium hover:bg-[#141414] hover:text-white transition-all flex items-center gap-2"
          >
            <Upload size={16} />
            Upload Facade
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImageUpload} 
            className="hidden" 
            accept="image/*"
          />
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Input & Analysis */}
        <div className="lg:col-span-5 space-y-8">
          <section className="bg-white border border-[#141414] rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-[#141414] flex justify-between items-center bg-[#141414] text-white">
              <span className="text-xs font-mono uppercase tracking-widest">Source Image</span>
              <span className="text-[10px] opacity-50">01 / INPUT</span>
            </div>
            <div className="bg-[#F0F0F0] relative group min-h-[200px] flex flex-col items-center justify-center">
              {selectedImage ? (
                <div className="w-full flex flex-col gap-4 p-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono uppercase opacity-50">Original View</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="p-1.5 hover:bg-white rounded transition-colors border border-transparent hover:border-[#141414]/20"
                          title="Replace image"
                        >
                          <Upload size={14} />
                        </button>
                        <button
                          onClick={() => downloadImage(selectedImage, 'facade-image.png')}
                          className="p-1.5 hover:bg-white rounded transition-colors border border-transparent hover:border-[#141414]/20"
                          title="Save to local"
                        >
                          <Download size={14} />
                        </button>
                      </div>
                    </div>
                    <img src={selectedImage} alt="Uploaded facade" className="max-w-full h-auto block mx-auto rounded-lg shadow-sm" />
                  </div>
                  {(segmentMasks || annotatedOverlayUrl) && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 w-full">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono uppercase opacity-50">
                          {segmentMasks ? (labelMode ? `当前: ${labelMode === 'glass' ? 'Glass' : 'Signboard'}，点击区域标注/取消，空白处添加新区块` : '先选择标签，再点击区域') : '标注分割图'}
                        </span>
                      </div>
                      <div className="relative border border-[#141414]/10 rounded-lg overflow-hidden bg-white">
                        {segmentMasks ? (
                          <MaskLabeler
                            imageUrl={selectedImage}
                            masks={segmentMasks.masks}
                            maskLabels={maskLabels}
                            labelMode={labelMode}
                            onMaskClick={handleMaskClick}
                            onAddMaskAtPoint={handleAddMaskAtPoint}
                            imgWidth={segmentMasks.width}
                            imgHeight={segmentMasks.height}
                            isAddingMask={isAnalyzing}
                          />
                        ) : annotatedOverlayUrl ? (
                          <img src={annotatedOverlayUrl} alt="Annotated segmentation" className="max-w-full h-auto block mx-auto" />
                        ) : null}
                      </div>
                      {segmentMasks && (
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-[10px] font-mono uppercase opacity-50">标签:</span>
                          <button
                            onClick={() => setLabelMode('glass')}
                            className={cn(
                              "px-4 py-1.5 text-[10px] font-bold uppercase rounded-full border transition-all",
                              labelMode === 'glass' ? "bg-blue-500 text-white border-blue-500" : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                            )}
                          >
                            Glass
                          </button>
                          <button
                            onClick={() => setLabelMode('signboard')}
                            className={cn(
                              "px-4 py-1.5 text-[10px] font-bold uppercase rounded-full border transition-all",
                              labelMode === 'signboard' ? "bg-red-500 text-white border-red-500" : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                            )}
                          >
                            Signboard
                          </button>
                          <button
                            onClick={() => setLabelMode(null)}
                            className="px-3 py-1.5 text-[10px] font-bold uppercase border border-[#141414]/20 rounded-full hover:bg-[#F0F0F0]"
                          >
                            取消选择
                          </button>
                          <span className="flex-1" />
                          <button
                            onClick={() => { setMaskLabels({}); }}
                            className="px-3 py-1.5 text-[10px] font-bold uppercase border border-[#141414]/20 rounded-full hover:bg-[#F0F0F0]"
                          >
                            清空标注
                          </button>
                          <button
                            onClick={confirmCompute}
                            className="px-4 py-1.5 text-[10px] font-bold uppercase bg-[#141414] text-white rounded-full hover:bg-black flex items-center gap-1"
                          >
                            <Check size={12} /> 确认计算
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              ) : (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-[#EAEAEA] transition-colors"
                >
                  <ImageIcon size={48} className="opacity-20 mb-4" />
                  <p className="text-sm font-medium opacity-40">Click to upload street facade</p>
                </div>
              )}
              {selectedImage && !segmentMasks && !metrics && (
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-[2px]">
                  <button 
                    onClick={runSegmentMasks}
                    disabled={isAnalyzing}
                    className="bg-white text-[#141414] px-6 py-3 rounded-full font-bold flex items-center gap-2 shadow-2xl hover:scale-105 transition-transform"
                  >
                    {isAnalyzing ? <Loader2 className="animate-spin" /> : <Zap size={20} />}
                    {isAnalyzing ? '分割中...' : 'SAM2 分割'}
                  </button>
                  <button 
                    onClick={startDirectLabeling}
                    disabled={isAnalyzing}
                    className="bg-white/90 text-[#141414] px-6 py-3 rounded-full font-bold flex items-center gap-2 shadow-2xl hover:scale-105 transition-transform border border-[#141414]/20"
                  >
                    直接标注
                  </button>
                </div>
              )}
            </div>
          </section>

          {metrics && (
            <motion.section 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white border border-[#141414] rounded-2xl overflow-hidden shadow-lg"
            >
              <div className="p-4 border-b border-[#141414] flex justify-between items-center">
                <span className="text-xs font-mono uppercase tracking-widest">Base Metrics</span>
                <span className="text-[10px] opacity-50 italic font-serif">Extracted via AI Vision</span>
              </div>
              <div className="p-6 space-y-6">
                <MetricBar 
                  label="Transparency" 
                  value={metrics.Transparency} 
                  icon={<Maximize2 size={16} />} 
                  description="Percentage of glazed surface area"
                />
                <MetricBar 
                  label="Signage Scale" 
                  value={metrics.SignageScale} 
                  icon={<Store size={16} />} 
                  description="Scale and density of shop signs"
                />
                <MetricBar 
                  label="Color Richness" 
                  value={metrics.ColorRichness} 
                  icon={<Zap size={16} />} 
                  description="Variety and vibrancy of the color palette"
                />
                {metrics.HueHistogram && metrics.HueHistogram.length > 0 && (
                  <HueHistogramChart data={metrics.HueHistogram} />
                )}
                
                <div className="pt-4 border-t border-[#141414]/10">
                  <span className="text-[10px] font-mono uppercase opacity-50 block mb-2">Architectural Style</span>
                  <p className="text-sm font-serif italic text-[#141414]/80 leading-relaxed mb-4">
                    "{metrics.StyleDescription}"
                  </p>
                  <span className="text-[10px] font-mono uppercase opacity-50 block mb-2">Analysis Reasoning</span>
                  <p className="text-[11px] text-[#141414]/60 leading-relaxed">
                    {metrics.Reasoning}
                  </p>
                </div>
              </div>
            </motion.section>
          )}
        </div>

        {/* Right Column: Generation & Controls */}
        <div className="lg:col-span-7 space-y-8">
          <section className="bg-white border border-[#141414] rounded-2xl overflow-hidden shadow-lg">
            <div className="p-4 border-b border-[#141414] flex justify-between items-center">
              <div className="flex gap-4">
                <button 
                  onClick={() => setActiveTab('analysis')}
                  className={cn(
                    "text-xs font-mono uppercase tracking-widest pb-1 border-b-2 transition-all",
                    activeTab === 'analysis' ? "border-[#141414] opacity-100" : "border-transparent opacity-30"
                  )}
                >
                  Controls
                </button>
                <button 
                  onClick={() => setActiveTab('generation')}
                  className={cn(
                    "text-xs font-mono uppercase tracking-widest pb-1 border-b-2 transition-all",
                    activeTab === 'generation' ? "border-[#141414] opacity-100" : "border-transparent opacity-30"
                  )}
                >
                  Variations ({generations.length})
                </button>
              </div>
            </div>

            <div className="p-6 min-h-[400px]">
              {activeTab === 'analysis' ? (
                <div className="space-y-8">
                  <div className="space-y-6">
                    <div className="border border-[#141414] rounded-xl p-4 bg-[#FAFAFA]">
                      <label className="text-[10px] font-mono uppercase tracking-widest opacity-50 block mb-2">Prompt-based editing</label>
                      <textarea
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder="e.g. Change signage to warm tones, add more glass curtain wall..."
                        className="w-full min-h-[80px] px-4 py-3 border border-[#141414]/20 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[#141414]/20"
                        disabled={isGenerating}
                      />
                      <button
                        onClick={generateFromPrompt}
                        disabled={isGenerating || !selectedImage || !customPrompt.trim()}
                        className="mt-3 w-full py-3 bg-[#141414] text-white rounded-lg font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                        {isGenerating ? 'Generating...' : 'Generate & Analyze'}
                      </button>
                    </div>
                  {!metrics ? (
                    <div className="h-[200px] flex flex-col items-center justify-center text-center opacity-30">
                      <RefreshCw size={48} className="mb-4 animate-spin-slow" />
                      <p className="text-sm">上传图片并完成 SAM2 分割与标注后，可在此查看指标</p>
                    </div>
                  ) : (
                    <div className="p-4 bg-[#FAFAFA] rounded-xl border border-[#141414]/10">
                      <p className="text-sm text-[#141414]/70">指标已根据手动标注计算完成，可使用下方 Prompt 生成新图。</p>
                    </div>
                  )}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {isGenerating && (
                    <div className="bg-[#141414] text-white p-8 rounded-xl flex flex-col items-center justify-center gap-4 animate-pulse">
                      <Loader2 size={32} className="animate-spin" />
                      <p className="text-sm font-mono uppercase tracking-widest">Synthesizing New Facade Design...</p>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <AnimatePresence mode="popLayout">
                      {generations.map((gen) => (
                        <motion.div 
                          key={gen.id}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="group relative bg-white border border-[#141414] rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all"
                        >
                          <img src={gen.imageUrl} alt="Generated variation" className="w-full h-auto block" />
                          <div className="p-4 bg-white border-t border-[#141414]">
                            <div className="flex justify-between items-center mb-3">
                              <span className="text-[10px] font-mono uppercase opacity-50">Variation Metrics</span>
                              <button 
                                onClick={() => downloadImage(gen.imageUrl, `facade-variation-${gen.id}.png`)}
                                className="p-1 hover:bg-[#F0F0F0] rounded transition-colors"
                                title="Download Image"
                              >
                                <Download size={14} />
                              </button>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              <Badge label="T" value={gen.metrics.transparency} />
                              <Badge label="S" value={gen.metrics.signage} />
                              <Badge label="C" value={gen.metrics.color} />
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  {generations.length === 0 && !isGenerating && (
                    <div className="h-[300px] flex flex-col items-center justify-center text-center opacity-30">
                      <ImageIcon size={48} className="mb-4" />
                      <p className="text-sm">No variations generated yet. Use the controls to create new designs.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="mt-12 border-t border-[#141414] p-8 text-center">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-30">
          AI-Driven Urban Interface Analysis & Generative Design Tool
        </p>
      </footer>
    </div>
  );
}

function HueHistogramChart({ data }: { data: number[] }) {
  const [continuous, setContinuous] = React.useState(false);
  const w = 280;
  const h = 72;
  const maxVal = Math.max(...data, 0.001);
  const n = data.length;

  if (continuous) {
    const pts = data.map((v, i) => [
      (i / Math.max(1, n - 1)) * w,
      h - (v / maxVal) * (h - 8),
    ]);
    const lineD = pts.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(' ');
    const areaD = `${lineD} L ${w} ${h} L 0 ${h} Z`;
    return (
      <div className="space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono uppercase opacity-50">Hue distribution</span>
          <button type="button" onClick={() => setContinuous(false)} className="text-[9px] opacity-50 hover:opacity-100">Bars</button>
        </div>
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-16 w-full rounded border border-[#141414]/10 bg-white">
          <defs>
            <linearGradient id="hueGrad" x1="0" x2="1" y1="0" y2="0">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((i) => (
                <stop key={i} offset={i / 17} stopColor={`hsl(${i * 20}, 85%, 55%)`} />
              ))}
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#hueGrad)" opacity={0.6} />
          <path d={lineD} fill="none" stroke="url(#hueGrad)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  const barW = Math.max(2, (w - (n - 1) * 2) / n);
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-mono uppercase opacity-50">Hue distribution (18 bins)</span>
        <button type="button" onClick={() => setContinuous(true)} className="text-[9px] opacity-50 hover:opacity-100">Continuous</button>
      </div>
      <div className="flex items-end gap-0.5 h-16 rounded border border-[#141414]/10 bg-white p-2">
        {data.map((v, i) => (
          <motion.div
            key={i}
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(4, (v / maxVal) * 100)}%` }}
            transition={{ duration: 0.6, delay: i * 0.02, ease: 'easeOut' }}
            className="flex-1 min-w-[3px] rounded-t"
            style={{ backgroundColor: `hsl(${i * 20}, 80%, 55%)` }}
            title={`${(i * 20).toFixed(0)}°: ${(v * 100).toFixed(1)}%`}
          />
        ))}
      </div>
    </div>
  );
}

function MetricBar({ label, value, icon, description }: { label: string, value: number, icon: React.ReactNode, description: string }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end">
        <div className="flex items-center gap-2">
          <span className="opacity-50">{icon}</span>
          <span className="text-xs font-bold uppercase tracking-tight">{label}</span>
        </div>
        <span className="text-2xl font-mono font-light">{value}%</span>
      </div>
      <div className="h-2 bg-[#F0F0F0] rounded-full overflow-hidden border border-[#141414]/5">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="h-full bg-[#141414]"
        />
      </div>
      <p className="text-[10px] opacity-40 italic">{description}</p>
    </div>
  );
}

function MaskLabeler({ imageUrl, masks, maskLabels, labelMode, onMaskClick, onAddMaskAtPoint, imgWidth, imgHeight, isAddingMask }: {
  imageUrl: string;
  masks: MaskItem[];
  maskLabels: Record<number, 'glass' | 'signboard'>;
  labelMode: 'glass' | 'signboard' | null;
  onMaskClick: (id: number) => void;
  onAddMaskAtPoint?: (x: number, y: number) => void;
  imgWidth: number;
  imgHeight: number;
  isAddingMask?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.offsetWidth;
      const scale = w / imgWidth;
      setSize({ w, h: imgHeight * scale });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [imgWidth, imgHeight]);

  const handleBackgroundClick = (e: React.MouseEvent<SVGRectElement>) => {
    if (!onAddMaskAtPoint || isAddingMask) return;
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    onAddMaskAtPoint(Math.round(svgPt.x), Math.round(svgPt.y));
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {size.w > 0 && (
        <div className="relative" style={{ width: size.w, height: size.h }}>
          <img src={imageUrl} alt="Facade" className="absolute inset-0 w-full h-full object-contain" style={{ objectFit: 'contain' }} />
          <svg className="absolute inset-0 w-full h-full pointer-events-none" width="100%" height="100%" viewBox={`0 0 ${imgWidth} ${imgHeight}`} preserveAspectRatio="xMidYMid meet">
            {masks.map((m) => {
              const label = maskLabels[m.id];
              const fill = label === 'glass' ? 'rgba(30, 144, 255, 0.55)' : label === 'signboard' ? 'rgba(220, 53, 69, 0.55)' : 'rgba(0, 180, 255, 0.45)';
              const pts = m.polygon.map(([x, y]) => `${x},${y}`).join(' ');
              return <polygon key={m.id} points={pts} fill={fill} stroke="rgba(0,0,0,0.25)" strokeWidth={1.5} />;
            })}
          </svg>
          <svg className="absolute inset-0 w-full h-full" style={{ cursor: isAddingMask ? 'wait' : 'pointer' }} width="100%" height="100%" viewBox={`0 0 ${imgWidth} ${imgHeight}`} preserveAspectRatio="xMidYMid meet">
            <rect x={0} y={0} width={imgWidth} height={imgHeight} fill="transparent" pointerEvents="all" onClick={handleBackgroundClick} />
            {masks.map((m) => {
              const pts = m.polygon.map(([x, y]) => `${x},${y}`).join(' ');
              return (
                <polygon
                  key={m.id}
                  points={pts}
                  fill="transparent"
                  pointerEvents="all"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMaskClick(m.id);
                  }}
                />
              );
            })}
          </svg>
          {isAddingMask && (
            <div className="absolute inset-0 bg-black/20 flex items-center justify-center pointer-events-none">
              <Loader2 className="animate-spin text-white" size={32} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({ label, value }: { label: string, value: number }) {
  return (
    <div className="flex items-center gap-1 bg-[#141414] text-white px-2 py-1 rounded text-[9px] font-mono">
      <span className="opacity-50">{label}:</span>
      <span>{value}%</span>
    </div>
  );
}

