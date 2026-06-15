/**
 * Audio Visualizer - Particle Diffusion
 * Web Audio API audio visualization component
 * Auto-initializes on elements with data-audio-viz attribute
 */
(function () {
  'use strict';

  // Configuration
  const CONFIG = {
    fftSize: 256,
    smoothingTimeConstant: 0.85,
    particleCount: 120,
    centerRadius: 40,
    maxParticleRadius: 6,
    minParticleRadius: 2,
    baseSpeed: 0.15,
    speedScale: 3.0,
    baseDistance: 60,
    distanceScale: 120,
    hueBase: 200,
    hueRange: 60,
    frequencyBinCount: null, // derived from fftSize
  };

  CONFIG.frequencyBinCount = CONFIG.fftSize / 2;

  // ---- Smoothing Buffer ----
  function createSmoother(size, smoothing) {
    var buffer = new Float32Array(size);
    return {
      update: function (raw) {
        for (var i = 0; i < size; i++) {
          buffer[i] = buffer[i] * smoothing + raw[i] * (1 - smoothing);
        }
        return buffer;
      },
      getValue: function () {
        return buffer;
      },
    };
  }

  // ---- Audio Context Manager ----
  var audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      var Ctor =
        window.AudioContext ||
        window.webkitAudioContext;
      audioCtx = new Ctor();
    }
    return audioCtx;
  }

  // ---- Particle ----
  function Particle(index, total) {
    var angle = (index / total) * Math.PI * 2;
    return {
      angle: angle,
      speed: CONFIG.baseSpeed,
      distance: CONFIG.baseDistance,
      radius: CONFIG.minParticleRadius,
      alpha: 1,
    };
  }

  // ---- Visualizer Instance ----
  function AudioVisualizer(container) {
    this.container = container;
    this.audioEl = container.querySelector('audio');
    this.canvas = null;
    this.ctx = null;
    this.analyser = null;
    this.smoother = null;
    this.particles = [];
    this.animationId = null;
    this.resizeHandler = null;
    this.isPlaying = false;
    this.sourceConnected = false;

    if (!this.audioEl) {
      console.warn('[AudioViz] No <audio> element found inside container.');
      return;
    }

    this._setupCanvas();
    this._setupAudio();
    this._createParticles();
    this._bindEvents();
    this._startLoop();
  }

  AudioVisualizer.prototype._setupCanvas = function () {
    var canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._resizeCanvas();
  };

  AudioVisualizer.prototype._resizeCanvas = function () {
    var rect = this.container.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this.centerX = rect.width / 2;
    this.centerY = rect.height / 2;
  };

  AudioVisualizer.prototype._setupAudio = function () {
    var ctx = getAudioContext();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = CONFIG.fftSize;
    this.analyser.smoothingTimeConstant = CONFIG.smoothingTimeConstant;

    this.smoother = createSmoother(
      CONFIG.frequencyBinCount,
      CONFIG.smoothingTimeConstant
    );

    var self = this;

    function tryConnect() {
      if (self.sourceConnected) return;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      try {
        var source = ctx.createMediaElementSource(self.audioEl);
        source.connect(self.analyser);
        self.analyser.connect(ctx.destination);
        self.sourceConnected = true;
      } catch (e) {
        // Already connected or not ready
      }
    }

    this.audioEl.addEventListener('play', function () {
      tryConnect();
      self.isPlaying = true;
    });

    this.audioEl.addEventListener('pause', function () {
      self.isPlaying = false;
    });

    this.audioEl.addEventListener('ended', function () {
      self.isPlaying = false;
    });
  };

  AudioVisualizer.prototype._createParticles = function () {
    this.particles = [];
    for (var i = 0; i < CONFIG.particleCount; i++) {
      this.particles.push(Particle(i, CONFIG.particleCount));
    }
  };

  AudioVisualizer.prototype._bindEvents = function () {
    var self = this;
    this.resizeHandler = function () {
      self._resizeCanvas();
    };
    window.addEventListener('resize', this.resizeHandler);
  };

  AudioVisualizer.prototype._getLowFreqEnergy = function (data) {
    // Average of lowest 1/4 frequency bins
    var count = Math.floor(CONFIG.frequencyBinCount / 4);
    var sum = 0;
    for (var i = 0; i < count; i++) {
      sum += data[i];
    }
    return sum / count; // 0-255
  };

  AudioVisualizer.prototype._getFrequencyRange = function (data, start, end) {
    var sum = 0;
    for (var i = start; i < end; i++) {
      sum += data[i];
    }
    return sum / (end - start);
  };

  AudioVisualizer.prototype._updateParticles = function (lowEnergy, avgEnergy) {
    var normalizedLow = lowEnergy / 255; // 0-1
    var normalizedAvg = avgEnergy / 255;

    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];

      // Speed scales with low frequency energy
      p.speed =
        CONFIG.baseSpeed + normalizedLow * CONFIG.speedScale;

      // Distance from center scales with low frequency energy
      p.distance =
        CONFIG.baseDistance + normalizedLow * CONFIG.distanceScale;

      // Particle size scales with energy (mix of low and avg)
      p.radius =
        CONFIG.minParticleRadius +
        (normalizedLow * 0.6 + normalizedAvg * 0.4) *
          (CONFIG.maxParticleRadius - CONFIG.minParticleRadius);

      // Alpha fades with distance from center
      p.alpha = 0.3 + normalizedLow * 0.7;

      // Update angle
      p.angle += p.speed * 0.02;
    }
  };

  AudioVisualizer.prototype._render = function () {
    var ctx = this.ctx;
    var w = this.width;
    var h = this.height;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);

    // Draw center circle
    var centerRadius =
      CONFIG.centerRadius +
      this._lastLowEnergy / 255 * 20;

    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, centerRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100, 180, 255, 0.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 180, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner glow
    var gradient = ctx.createRadialGradient(
      this.centerX,
      this.centerY,
      0,
      this.centerX,
      this.centerY,
      centerRadius * 1.5
    );
    gradient.addColorStop(0, 'rgba(100, 180, 255, 0.08)');
    gradient.addColorStop(1, 'rgba(100, 180, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, centerRadius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Draw particles
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      var x = this.centerX + Math.cos(p.angle) * p.distance;
      var y = this.centerY + Math.sin(p.angle) * p.distance;

      // Hue shifts with angle and energy
      var hue =
        CONFIG.hueBase +
        (i / this.particles.length) * CONFIG.hueRange +
        this._lastLowEnergy * 0.2;

      ctx.beginPath();
      ctx.arc(x, y, p.radius, 0, Math.PI * 2);

      ctx.fillStyle =
        'hsla(' +
        hue +
        ', 80%, 60%, ' +
        p.alpha +
        ')';
      ctx.fill();

      // Glow effect on larger particles
      if (p.radius > CONFIG.minParticleRadius + 1) {
        ctx.beginPath();
        ctx.arc(x, y, p.radius * 2, 0, Math.PI * 2);
        ctx.fillStyle =
          'hsla(' +
          hue +
          ', 80%, 60%, ' +
          p.alpha * 0.15 +
          ')';
        ctx.fill();
      }

      // Connecting line to center when energy is high
      if (this._lastLowEnergy > 100) {
        var lineAlpha = (this._lastLowEnergy - 100) / 155 * 0.3;
        ctx.beginPath();
        ctx.moveTo(this.centerX, this.centerY);
        ctx.lineTo(x, y);
        ctx.strokeStyle =
          'hsla(' +
          hue +
          ', 80%, 60%, ' +
          lineAlpha +
          ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  };

  AudioVisualizer.prototype._tick = function () {
    if (!this.analyser) return;

    var data = new Uint8Array(CONFIG.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);

    var smoothed = this.smoother.update(data);
    var lowEnergy = this._getLowFreqEnergy(smoothed);
    var avgEnergy =
      this._getFrequencyRange(smoothed, 0, CONFIG.frequencyBinCount);

    this._lastLowEnergy = lowEnergy;
    this._updateParticles(lowEnergy, avgEnergy);
    this._render();
  };

  AudioVisualizer.prototype._startLoop = function () {
    var self = this;
    function loop() {
      self._tick();
      self.animationId = requestAnimationFrame(loop);
    }
    loop();
  };

  AudioVisualizer.prototype.destroy = function () {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  };

  // ---- Auto Initialize ----
  function initAll() {
    var containers = document.querySelectorAll('[data-audio-viz]');
    for (var i = 0; i < containers.length; i++) {
      var el = containers[i];
      if (!el._audioVizInstance) {
        el._audioVizInstance = new AudioVisualizer(el);
      }
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
