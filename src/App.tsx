/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { doubaoImageGenerate } from './api/doubao';
import { sam2Segment, sam2ColorRichnessFull } from './api/sam2';
import { exportToXlsx } from './utils/exportXlsx';
import { 
  Upload, 
  Zap, 
  Layers, 
  Maximize2, 
  Store, 
  RefreshCw, 
  Plus, 
  Minus,
  Image as ImageIcon,
  Loader2,
  Download,
  Edit3,
  Check,
  Eraser,
  FileSpreadsheet
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Stage, Layer, Image as KonvaImage, Line } from 'react-konva';
import useImage from 'use-image';

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
  const [gradient, setGradient] = useState(10);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generations, setGenerations] = useState<GenerationResult[]>([]);
  const [activeTab, setActiveTab] = useState<'analysis' | 'generation'>('analysis');
  const [isEditingSeg, setIsEditingSeg] = useState(false);
  const [brushColor, setBrushColor] = useState('#3b82f6'); // Default Blue
  const [lines, setLines] = useState<any[]>([]);
  const [customPrompt, setCustomPrompt] = useState('');
  const [lastAnalysisTimestamp, setLastAnalysisTimestamp] = useState<string | null>(null);
  const [lastGenerationMeta, setLastGenerationMeta] = useState<{ prompt: string; model: string; seed: number; timestamp: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<any>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setSelectedImage(result);
        setMetrics(null);
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

  const analyzeImage = async (customSegMap?: string) => {
    if (!selectedImage) return;
    setIsAnalyzing(true);
    if (!customSegMap) setMetrics(null);

    try {
      const result = await sam2Segment(selectedImage);
      setMetrics({
        Transparency: result.Transparency,
        SignageScale: result.SignageScale,
        ColorRichness: result.ColorRichness,
        ColorRichnessRaw: result.ColorRichnessRaw,
        ColorRawVars: result.ColorRawVars,
        HueHistogram: result.HueHistogram,
        StyleDescription: result.StyleDescription,
        Reasoning: result.Reasoning,
        segmentationImageUrl: customSegMap ?? result.segmentation_image_base64,
      });
      setLastAnalysisTimestamp(new Date().toISOString());
      setActiveTab('analysis');
    } catch (error: unknown) {
      console.error("Analysis failed:", error);
      let msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('fetch') || msg.includes('Failed to fetch')) {
        msg = 'Cannot connect to SAM2. Run: cd sam2_server && pip install -r requirements.txt && python -m uvicorn app:app --port 3002';
      }
      alert("Analysis failed: " + (msg || "Check SAM2 service."));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const downloadImage = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveSegmentation = () => {
    if (stageRef.current) {
      const dataUrl = stageRef.current.toDataURL();
      setIsEditingSeg(false);
      setLines([]); // Clear lines after saving
      analyzeImage(dataUrl); // Re-analyze with custom map
    }
  };

  const handleMouseDown = (e: any) => {
    if (!isEditingSeg) return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    setLines([...lines, { tool: 'brush', color: brushColor, points: [pos.x, pos.y] }]);
  };

  const handleMouseMove = (e: any) => {
    if (!isEditingSeg || lines.length === 0) return;
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    let lastLine = { ...lines[lines.length - 1] };
    lastLine.points = lastLine.points.concat([point.x, point.y]);
    
    const newLines = [...lines];
    newLines[newLines.length - 1] = lastLine;
    setLines(newLines);
  };

  const handleMouseUp = () => {
    // End of drawing line
  };

  const generateVariation = async (direction: 'increase' | 'decrease', type: keyof Omit<FacadeMetrics, 'StyleDescription' | 'Reasoning' | 'segmentationImageUrl'>) => {
    if (!selectedImage || !metrics) return;
    const config = getDoubaoConfig();
    if (!config || !config.imageEndpoint) {
      alert('Configure DOUBAO_API_KEY and DOUBAO_IMAGE_ENDPOINT in .env');
      return;
    }
    setIsGenerating(true);
    setActiveTab('generation');

    try {
      const newMetrics = {
        transparency: type === 'Transparency' 
          ? Math.min(100, Math.max(0, metrics.Transparency + (direction === 'increase' ? gradient : -gradient)))
          : metrics.Transparency,
        signage: type === 'SignageScale'
          ? Math.min(100, Math.max(0, metrics.SignageScale + (direction === 'increase' ? gradient : -gradient)))
          : metrics.SignageScale,
        color: type === 'ColorRichness'
          ? Math.min(100, Math.max(0, metrics.ColorRichness + (direction === 'increase' ? gradient : -gradient)))
          : metrics.ColorRichness,
      };

      const prompt = `Facade redesign task. Modify only the building facade in the image. Keep original proportions, perspective, and surroundings (sky, street, adjacent buildings) unchanged.
Redesign the facade to achieve: transparency ${newMetrics.transparency}%, signage scale ${newMetrics.signage}%, color richness ${newMetrics.color}%.
Preserve architectural style: ${metrics.StyleDescription}. Result should look like a real renovation, no cropping or resizing.`;

      const { imageUrl, seed } = await doubaoImageGenerate(config, prompt, { image: selectedImage });

      const ts = new Date().toISOString();
      setLastGenerationMeta({ prompt, model: config.imageEndpoint, seed, timestamp: ts });
      setGenerations(prev => [{
        id: Date.now().toString(),
        imageUrl,
        metrics: newMetrics,
        prompt,
        model: config.imageEndpoint,
        seed,
        timestamp: ts,
      }, ...prev]);
    } catch (error: unknown) {
      console.error("Generation failed:", error);
      const msg = error instanceof Error ? error.message : String(error);
      alert("Generation failed: " + (msg || "Please retry."));
    } finally {
      setIsGenerating(false);
    }
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
      setActiveTab('analysis');
      await analyzeImageWithImage(imageUrl);
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
    let metricsToExport = metrics
      ? { Transparency: metrics.Transparency, SignageScale: metrics.SignageScale, ColorRichness: metrics.ColorRichness, ColorRichnessRaw: metrics.ColorRichnessRaw, ColorRawVars: metrics.ColorRawVars }
      : generations[0]
        ? { Transparency: generations[0].metrics.transparency, SignageScale: generations[0].metrics.signage, ColorRichness: generations[0].metrics.color, ColorRichnessRaw: undefined as number | undefined, ColorRawVars: undefined as typeof metrics.ColorRawVars }
        : undefined;
    // 对导出图片调用 color-richness 获取 ColorRawVars，确保与导出图像一致（兼容旧 SAM2、生成图等场景）
    try {
      const crData = await sam2ColorRichnessFull(imageToExport);
      metricsToExport = {
        ...(metricsToExport ?? {}),
        ColorRichness: metricsToExport?.ColorRichness ?? crData.ColorRichness,
        ColorRichnessRaw: crData.ColorRichnessRaw,
        ColorRawVars: crData.ColorRawVars,
      };
    } catch (e) {
      console.warn('Could not fetch ColorRawVars for export:', e);
    }
    await exportToXlsx({
      imageDataUrl: imageToExport,
      timestamp,
      metrics: metricsToExport ?? undefined,
      generation: lastGenerationMeta ?? undefined,
    });
  };

  const analyzeImageWithImage = async (imageUrl: string) => {
    setIsAnalyzing(true);
    try {
      const result = await sam2Segment(imageUrl);
      setMetrics({
        Transparency: result.Transparency,
        SignageScale: result.SignageScale,
        ColorRichness: result.ColorRichness,
        ColorRichnessRaw: result.ColorRichnessRaw,
        ColorRawVars: result.ColorRawVars,
        HueHistogram: result.HueHistogram,
        StyleDescription: result.StyleDescription,
        Reasoning: result.Reasoning,
        segmentationImageUrl: result.segmentation_image_base64,
      });
      setLastAnalysisTimestamp(new Date().toISOString());
    } catch (error: unknown) {
      console.error('Analysis failed:', error);
      const msg = error instanceof Error ? error.message : 'Check SAM2 service.';
      alert('Analysis failed: ' + msg);
    } finally {
      setIsAnalyzing(false);
    }
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
                  {metrics?.segmentationImageUrl && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-2 w-full"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono uppercase opacity-50">Instance Segmentation Map</span>
                        <div className="flex gap-2">
                          <div className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-500 rounded-full"></div><span className="text-[8px] uppercase">Glass</span></div>
                          <div className="flex items-center gap-1"><div className="w-2 h-2 bg-red-500 rounded-full"></div><span className="text-[8px] uppercase">Signage</span></div>
                        </div>
                      </div>
                      
                      <div className="relative border border-[#141414]/10 rounded-lg overflow-hidden bg-white">
                        {isEditingSeg ? (
                          <div className="flex flex-col">
                            <div className="p-2 bg-[#F0F0F0] border-b border-[#141414]/10 flex justify-between items-center">
                              <div className="flex gap-2">
                                <BrushButton color="#3b82f6" active={brushColor === '#3b82f6'} onClick={() => setBrushColor('#3b82f6')} label="Glass" />
                                <BrushButton color="#ef4444" active={brushColor === '#ef4444'} onClick={() => setBrushColor('#ef4444')} label="Signage" />
                                <button 
                                  onClick={() => setLines([])}
                                  className="p-1.5 hover:bg-white rounded text-[#141414]/50 hover:text-red-500 transition-colors"
                                  title="Clear Edits"
                                >
                                  <Eraser size={14} />
                                </button>
                              </div>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => { setIsEditingSeg(false); setLines([]); }}
                                  className="px-3 py-1 text-[10px] font-bold uppercase border border-[#141414]/20 rounded-full hover:bg-white"
                                >
                                  Cancel
                                </button>
                                <button 
                                  onClick={handleSaveSegmentation}
                                  className="px-3 py-1 text-[10px] font-bold uppercase bg-[#141414] text-white rounded-full hover:bg-black flex items-center gap-1"
                                >
                                  <Check size={12} /> Apply & Re-Analyze
                                </button>
                              </div>
                            </div>
                            <SegmentationCanvas 
                              imageUrl={metrics.segmentationImageUrl} 
                              lines={lines} 
                              onMouseDown={handleMouseDown}
                              onMouseMove={handleMouseMove}
                              onMouseUp={handleMouseUp}
                              stageRef={stageRef}
                            />
                          </div>
                        ) : (
                          <div className="group relative">
                            <img src={metrics.segmentationImageUrl} alt="Segmentation map" className="max-w-full h-auto block mx-auto" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                              <button 
                                onClick={() => setIsEditingSeg(true)}
                                className="bg-white text-[#141414] px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 shadow-lg hover:scale-105 transition-transform"
                              >
                                <Edit3 size={14} />
                                Edit Segmentation
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
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
              {selectedImage && !metrics && (
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                  <button 
                    onClick={() => analyzeImage()}
                    disabled={isAnalyzing}
                    className="bg-white text-[#141414] px-6 py-3 rounded-full font-bold flex items-center gap-2 shadow-2xl hover:scale-105 transition-transform"
                  >
                    {isAnalyzing ? <Loader2 className="animate-spin" /> : <Zap size={20} />}
                    {isAnalyzing ? 'Analyzing...' : 'Analyze Metrics'}
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
              <div className="flex items-center gap-3 bg-[#F0F0F0] px-3 py-1 rounded-full">
                <span className="text-[10px] font-mono uppercase opacity-50">Step Gradient</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setGradient(Math.max(5, gradient - 5))} className="hover:text-blue-600"><Minus size={12} /></button>
                  <span className="text-xs font-bold w-8 text-center">{gradient}%</span>
                  <button onClick={() => setGradient(Math.min(50, gradient + 5))} className="hover:text-blue-600"><Plus size={12} /></button>
                </div>
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
                      <p className="text-sm">Upload and analyze an image to unlock design controls</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <ControlCard 
                        title="Transparency" 
                        value={metrics.Transparency}
                        onIncrease={() => generateVariation('increase', 'Transparency')}
                        onDecrease={() => generateVariation('decrease', 'Transparency')}
                        isGenerating={isGenerating}
                        gradient={gradient}
                      />
                      <ControlCard 
                        title="Signage" 
                        value={metrics.SignageScale}
                        onIncrease={() => generateVariation('increase', 'SignageScale')}
                        onDecrease={() => generateVariation('decrease', 'SignageScale')}
                        isGenerating={isGenerating}
                        gradient={gradient}
                      />
                      <ControlCard 
                        title="Colors" 
                        value={metrics.ColorRichness}
                        onIncrease={() => generateVariation('increase', 'ColorRichness')}
                        onDecrease={() => generateVariation('decrease', 'ColorRichness')}
                        isGenerating={isGenerating}
                        gradient={gradient}
                      />
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

function ControlCard({ title, value, onIncrease, onDecrease, isGenerating, gradient }: { 
  title: string, 
  value: number, 
  onIncrease: () => void, 
  onDecrease: () => void,
  isGenerating: boolean,
  gradient: number
}) {
  return (
    <div className="p-6 border border-[#141414] rounded-xl space-y-6 hover:bg-[#F9F9F9] transition-colors group">
      <div className="text-center">
        <h3 className="text-[10px] font-mono uppercase tracking-widest opacity-50 mb-1">{title}</h3>
        <div className="text-3xl font-mono font-bold">{value}%</div>
      </div>
      
      <div className="flex flex-col gap-3">
        <button 
          onClick={onIncrease}
          disabled={isGenerating || value >= 100}
          className="w-full py-3 border border-[#141414] rounded-lg flex items-center justify-center gap-2 hover:bg-[#141414] hover:text-white transition-all disabled:opacity-30"
        >
          <Plus size={16} />
          <span className="text-xs font-bold">+{gradient}%</span>
        </button>
        <button 
          onClick={onDecrease}
          disabled={isGenerating || value <= 0}
          className="w-full py-3 border border-[#141414] rounded-lg flex items-center justify-center gap-2 hover:bg-[#141414] hover:text-white transition-all disabled:opacity-30"
        >
          <Minus size={16} />
          <span className="text-xs font-bold">-{gradient}%</span>
        </button>
      </div>
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

function BrushButton({ color, active, onClick, label }: { color: string, active: boolean, onClick: () => void, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-bold uppercase transition-all border",
        active ? "bg-white border-[#141414] shadow-sm" : "bg-transparent border-transparent opacity-50 hover:opacity-100"
      )}
    >
      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }}></div>
      {label}
    </button>
  );
}

function SegmentationCanvas({ imageUrl, lines, onMouseDown, onMouseMove, onMouseUp, stageRef }: any) {
  const [image] = useImage(imageUrl);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (image) {
      const containerWidth = containerRef.current?.offsetWidth || 0;
      const scale = containerWidth / image.width;
      setDimensions({
        width: containerWidth,
        height: image.height * scale
      });
    }
  }, [image]);

  return (
    <div ref={containerRef} className="w-full bg-white cursor-crosshair">
      {dimensions.width > 0 && (
        <Stage
          width={dimensions.width}
          height={dimensions.height}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          ref={stageRef}
        >
          <Layer>
            <KonvaImage 
              image={image} 
              width={dimensions.width} 
              height={dimensions.height} 
            />
            {lines.map((line: any, i: number) => (
              <Line
                key={i}
                points={line.points}
                stroke={line.color}
                strokeWidth={10}
                tension={0.5}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation={
                  line.tool === 'eraser' ? 'destination-out' : 'source-over'
                }
              />
            ))}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
