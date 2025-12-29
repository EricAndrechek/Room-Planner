let Knob;
(function(undefined) {

  /**
   *   Default
   * Orientation
   *      90
   *  180  +  0
   *      270
   **/

  Knob = function(inputEl, callback) {
    this.__callback = callback;
    this.element = inputEl;
    if(!this.element) {
      throw new Error('No input element specified for knob.');
    }

    const parseBool = (boolStr) => boolStr && boolStr.toLowerCase() == 'true';

    // parse the attributes from the input element
    const options = {}

    if (inputEl.hasAttribute('min')) {
      options.valueMin = parseFloat(inputEl.getAttribute('min'));
    }
    if (inputEl.hasAttribute('max')) {
      options.valueMax = parseFloat(inputEl.getAttribute('max'));
    }
    if (inputEl.hasAttribute('value')) {
      options.value = parseFloat(inputEl.getAttribute('value'));
    }
    if (inputEl.hasAttribute('data-angle-start')) {
      options.angleStart = parseFloat(inputEl.getAttribute('data-angle-start'));
    }
    if (inputEl.hasAttribute('data-angle-end')) {
      options.angleEnd = parseFloat(inputEl.getAttribute('data-angle-end'));
    }
    if (inputEl.hasAttribute('data-angle-value-ratio')) {
      options.angleValueRatio = parseFloat(inputEl.getAttribute('data-angle-value-ratio'));
    }
    if (inputEl.hasAttribute('data-angle-slide-ratio')) {
      options.angleSlideRatio = parseFloat(inputEl.getAttribute('data-angle-slide-ratio'));
    }
    if (inputEl.hasAttribute('data-angle-scroll-ratio')) {
      options.angleScrollRatio = parseFloat(inputEl.getAttribute('data-angle-scroll-ratio'));
    }
    if (inputEl.hasAttribute('data-gesture-spin-enabled')) {
      options.gestureSpinEnabled = parseBool(inputEl.getAttribute('data-gesture-spin-enabled'));
    }
    if (inputEl.hasAttribute('data-gesture-slidex-enabled')) {
      options.gestureSlideXEnabled = parseBool(inputEl.getAttribute('data-gesture-slidex-enabled'));
    }
    if (inputEl.hasAttribute('data-gesture-slidey-enabled')) {
      options.gestureSlideYEnabled = parseBool(inputEl.getAttribute('data-gesture-slidey-enabled'));
    }
    if (inputEl.hasAttribute('data-gesture-scroll-enabled')) {
      options.gestureScrollEnabled = parseBool(inputEl.getAttribute('data-gesture-scroll-enabled'));
    }
    if (inputEl.hasAttribute('data-center-offset-x')) {
      options.centerOffsetX = parseFloat(inputEl.getAttribute('data-center-offset-x'));
    }
    if (inputEl.hasAttribute('data-center-offset-y')) {
      options.centerOffsetY = parseFloat(inputEl.getAttribute('data-center-offset-y'));
    }

    this.options = {
      gestureSpinEnabled: true,
      gestureSlideXEnabled: true,
      gestureSlideYEnabled: true,
      gestureScrollEnabled: true,
      angleStart: Number.NEGATIVE_INFINITY,
      angleEnd: Number.POSITIVE_INFINITY,
      valueMin: 0,
      valueMax: 100,
      value: 0,
      angleValueRatio: 0.1,
      angleSlideRatio: 2.0,
      angleScrollRatio: 0.5,
      centerOffsetX: 0,
      centerOffsetY: 0,
    };

    for (const key in options) {
      if(this.options[key] !== undefined)
        this.options[key] = options[key];
    }

    if(this.options.valueMin > this.options.valueMax) {
      throw new Error("valueMin must be less than valueMax");
    }

    this.val(this.options.value);
  };

  function constrain(value, low, high) {
    if(low > high) {
      const tmp = low;
      low = high;
      high = tmp;
    }
    return (value < low) ? low : ((value > high) ? high : value);
  };

  function toDegrees(radians) {
    return radians*(180/Math.PI);
  };

  function smallestAngleDistance(angle1, angle2) {
    const d = Math.abs(angle1 - angle2) % 360;
    return d > 180 ? 360 - d : d;
  }

  function angleDistance(angle1, angle2) {
    return angle1 % 360 - angle2 % 360;
  }

  function angleFromCoord(x, y, originX, originY) {
    const ny = originY - y,
        nx = x - originX;
    return toDegrees(Math.atan2(-ny,-nx)+Math.PI);
  }

  function pointDistance(x0, y0, x1, y1) {
    return Math.sqrt((x0 -= x1) * x0 + (y0 -= y1) * y0);
  }

  function isAngleIncreasing(prevAngle, nextAngle) {
    const lowerBound = 30,
          upperBound = 360 - lowerBound;

    if(prevAngle < lowerBound && nextAngle > upperBound) {
      return false;
    } else if(prevAngle > upperBound && nextAngle < lowerBound) {
      return true;
    } else {
      return prevAngle < nextAngle;
    }
  }

  function normalizeAngle(angle) {
    let normalized = angle % 360;
    while (normalized < 0) { normalized += 360; }
    return normalized;
  };

  const members = {
    __angle: 0,
    __value: 0,
    __centerPageX: 0,
    __centerPageY: 0,
    __isSingleTouch: false,
    __isTracking: false,
    __isTurning: false,
    __initialTouchLeft: null,
    __initialTouchTop: null,
    __initialTouchLocationX: null,
    __initialTouchLocationY: null,
    __slideXDetected: false,
    __slideYDetected: false,
    __spinDetected: false,
    __lastTouchLeft: null,
    __lastTouchTop: null,
    __lastTouchMove: null,
    __positions: null,
    __clientLeft: 0,
    __clientTop: 0,
    __clientWidth: 0,
    __clientHeight: 0,

    setDimensions: function(clientWidth, clientHeight) {
      const self = this;
      if (clientWidth) {
        self.__clientWidth = clientWidth;
      }
      if (clientHeight) {
        self.__clientHeight = clientHeight;
      }
      self.__updateCenterLocation();
      self.__publish();
    },

    setPosition: function(left, top) {
      const self = this;
      self.__clientLeft = left || 0;
      self.__clientTop = top || 0;
      self.__updateCenterLocation();
      self.__publish();
    },

    val: function(value) {
      if(value !== undefined) {
        this.__validateAndPublishValue(value, true);
      }
      return this.__value;
    },

    angle: function(angle) {
      if(angle !== undefined) {
        this.__validateAndPublishAngle(angle, true);
      }
      return this.__angle;
    },

    doMouseScroll: function(wheelDelta, timeStamp, pageX, pageY) {
      const self = this;
      if (!self.options.gestureScrollEnabled) return
      let change = constrain(wheelDelta, -20, 20);
      change = (pageX >= self.__centerPageX) ? -change : change;
      change *= self.options.angleScrollRatio;
      self.__validateAndPublishAngle(self.__angle + change);
    },

    doTouchStart: function(touches, timeStamp) {
      if (touches.length == null) {
        throw new Error("Invalid touch list: " + touches);
      }
      if (typeof timeStamp !== "number") {
        throw new Error("Invalid timestamp value: " + timeStamp);
      }

      const self = this,
            isSingleTouch = touches.length === 1,
            currentTouchLeft = touches[0].pageX,
            currentTouchTop  = touches[0].pageY;

      self.__initialTouchLeft = currentTouchLeft;
      self.__initialTouchTop  = currentTouchTop;
      self.__initialAngle = angleFromCoord(self.__initialTouchLeft, self.__initialTouchTop, self.__centerPageX, self.__centerPageY);
      self.__initialAngleDiff = angleDistance(self.__initialAngle, self.__angle);
      self.__lastTouchLeft = currentTouchLeft;
      self.__lastTouchTop  = currentTouchTop;
      self.__lastTouchMove = timeStamp;
      self.__slideXDetected = false; // Start with slides disabled for single touch
      self.__slideYDetected = false; // Start with slides disabled for single touch
      self.__initialTouchLocationX = (currentTouchLeft >= self.__centerPageX) ? "right" : "left";
      self.__initialTouchLocationY = (currentTouchTop  >= self.__centerPageY) ? "bottom" : "top";
      self.__isTracking = true;
      self.__isTurning = !isSingleTouch;
      self.__spinDetected = true; // Always start with spin enabled
      self.__totalDistance = 0;
      self.__isSingleTouch = isSingleTouch;
      self.__isGestureLocked = false;
      self.__positions = [];
    },

    doTouchMove: function(touches, timeStamp, scale) {
      if (touches.length == null) {
        throw new Error("Invalid touch list: " + touches);
      }
      if (typeof timeStamp !== "number") {
        throw new Error("Invalid timestamp value: " + timeStamp);
      }

      const self = this;
      if (!self.__isTracking) {
        return;
      }

      const currentTouchLeft = touches[0].pageX,
            currentTouchTop  = touches[0].pageY,
            positions = self.__positions;

      self.__validateAndPublishAngle(self.__getAngleFromGesture(currentTouchLeft, currentTouchTop));
      self.__isTurning = true;

      if (!self.__isGestureLocked) {
        const minimumTrackingForChange = 35,
              minimumDistanceForLocking = 40,
              maximumSlideVariance = 5,
              distanceX = Math.abs(currentTouchLeft - self.__initialTouchLeft),
              distanceY = Math.abs(currentTouchTop  - self.__initialTouchTop);

        self.__slideXDetected = self.options.gestureSlideXEnabled && distanceX >= minimumTrackingForChange && distanceY < maximumSlideVariance;
        self.__slideYDetected = self.options.gestureSlideYEnabled && distanceY >= minimumTrackingForChange && distanceX < maximumSlideVariance;

        if(self.__totalDistance > minimumDistanceForLocking) {
          self.__isGestureLocked = true;
          if(self.__slideXDetected && self.__slideYDetected) {
            self.__slideXDetected = self.__slideYDetected = false;
            self.__spinDetected = self.options.gestureSpinEnabled;
          }
          else if(self.__slideXDetected) {
            self.__spinDetected = self.__slideYDetected = false;
          }
          else if(self.__slideYDetected) {
            self.__spinDetected = self.__slideXDetected = false;
          }
        }

        self.__totalDistance += pointDistance(self.__lastTouchLeft, self.__lastTouchTop, currentTouchLeft, currentTouchTop);
      }

      if (positions.length > 60) {
        positions.splice(0, 30);
      }

      positions.push({
        left: currentTouchLeft,
        top: currentTouchTop,
        time: timeStamp
      });

      self.__lastTouchLeft = currentTouchLeft;
      self.__lastTouchTop = currentTouchTop;
      self.__lastTouchMove = timeStamp;
    },

    doTouchEnd: function(timeStamp) {
      if (typeof timeStamp !== "number") {
        throw new Error("Invalid timestamp value: " + timeStamp);
      }

      const self = this;
      if (!self.__isTracking) {
        return;
      }
      self.__isTurning = false;
      self.__positions.length = 0;
    },

    __validateAndPublishAngle: function(angle, forcePublish) {
      const self = this
      let diff;

      if (forcePublish) {
        this.__angle = self.__validateAngle(angle, true);
      }

      const prevAngle = self.__angle;
      const nPreviousAngle = normalizeAngle(prevAngle);
      const nCurrentAngle  = normalizeAngle(angle);
      diff = smallestAngleDistance(nPreviousAngle, nCurrentAngle);
      diff = isAngleIncreasing(nPreviousAngle, nCurrentAngle) ? diff : -diff;
      const nextAngle = self.__validateAngle(self.__angle + diff);

      self.__angle = nextAngle;
      self.__value = self.__valueFromAngles(forcePublish ? nextAngle : prevAngle, nextAngle);
      self.__publish();
    },

    __validateAndPublishValue: function(value, forcePublish) {
      const self = this;
      self.__value = self.__validateValue(value, true);
      self.__angle = self.__angleFromValue(self.__value);
      self.__publish();
    },

    __validateAngle: function(angle, force) {
      const self = this;
      angle = constrain(angle, self.options.angleStart, self.options.angleEnd);

      if(!force) {
        const threshold = 30;
        if(self.__angle == self.options.angleStart && Math.abs(angle-self.__angle) > threshold ) {
          angle = self.options.angleStart;
        }
        if(self.__angle == self.options.angleEnd && Math.abs(angle-self.__angle) > threshold) {
          angle = self.options.angleEnd;
        }
      }
      return angle;
    },

    __validateValue: function(value, force) {
      const self = this;
      return constrain(value, self.options.valueMin, self.options.valueMax);
    },

    __valueFromAngles: function(prevAngle, nextAngle) {
      const self = this;
      const value = self.__value + (prevAngle - nextAngle) * self.options.angleValueRatio;
      return self.__validateValue(value);
    },

    __angleFromValue: function(value) {
      const self = this;
      const angle = self.__angle + (value - self.__value) / self.options.angleValueRatio;
      return self.__validateAngle(angle, true);
    },

    __publish: function() {
      const self = this;
      if (self.__callback) {
        self.__callback(self);
      }
    },

    __getAngleFromGesture: function(currentTouchLeft, currentTouchTop) {
      const self = this;
      let angle = self.__angle;

      if(self.__spinDetected) {
        angle = angleFromCoord(currentTouchLeft, currentTouchTop, self.__centerPageX, self.__centerPageY);
        angle -= self.__initialAngleDiff;
      }
      else {
        if (self.__slideXDetected) {
          const change = (currentTouchLeft - self.__lastTouchLeft) * self.options.angleSlideRatio;
          angle += (self.__initialTouchLocationY === "top") ? -change : change;
        }

        if (self.__slideYDetected) {
          const change = (currentTouchTop - self.__lastTouchTop) * self.options.angleSlideRatio;
          angle += (self.__initialTouchLocationX === "right") ? -change : change;
        }
      }

      return angle;
    },

    __updateCenterLocation: function() {
      const self = this;
      self.__centerPageX = self.__clientLeft + self.__clientWidth/2 + self.options.centerOffsetX;
      self.__centerPageY = self.__clientTop + self.__clientHeight/2 + self.options.centerOffsetY;
    }
  }

  for (const key in members) {
    Knob.prototype[key] = members[key];
  }
})();

export default Knob;
