package matcher

import (
	"sync"
	"time"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
)

// Window aggregates incoming ride requests into discrete batches over time or size thresholds.
// It triggers onFlush whenever either condition is met:
//  1. The time elapsed since the first pending request arrived (windowStart) reaches windowDuration.
//  2. The count of pending requests reaches maxBatchSize.
//
// Concurrency & Thread-Safety:
// All mutations and reads of pending and windowStart are protected by mu.
// Flushes always capture and clear pending under the lock, and invoke onFlush OUTSIDE
// the lock so slow execution (e.g. Hungarian algorithm solves) never blocks incoming Add calls.
type Window struct {
	mu             sync.Mutex
	pending        []models.RideRequest
	windowStart    time.Time
	windowDuration time.Duration
	maxBatchSize   int
	onFlush        func(batch []models.RideRequest)

	stopChan chan struct{}
	doneChan chan struct{}
	stopOnce sync.Once
}

// NewWindow creates and starts a new Window batcher.
// A background goroutine checks periodically (at min(windowDuration/5, 20ms) interval,
// floor 5ms) whether windowDuration has elapsed since windowStart for non-empty pending requests.
func NewWindow(windowDuration time.Duration, maxBatchSize int, onFlush func([]models.RideRequest)) *Window {
	w := &Window{
		windowDuration: windowDuration,
		maxBatchSize:   maxBatchSize,
		onFlush:        onFlush,
		stopChan:       make(chan struct{}),
		doneChan:       make(chan struct{}),
	}

	checkInterval := windowDuration / 5
	if checkInterval > 20*time.Millisecond {
		checkInterval = 20 * time.Millisecond
	}
	if checkInterval < 5*time.Millisecond {
		checkInterval = 5 * time.Millisecond
	}

	go w.runLoop(checkInterval)

	return w
}

// runLoop periodically evaluates the time elapsed for pending items.
func (w *Window) runLoop(interval time.Duration) {
	defer close(w.doneChan)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-w.stopChan:
			return
		case <-ticker.C:
			w.checkAndFlushOnTimeout()
		}
	}
}

// checkAndFlushOnTimeout flushes the pending batch if windowDuration has passed since windowStart.
func (w *Window) checkAndFlushOnTimeout() {
	var toFlush []models.RideRequest

	w.mu.Lock()
	if len(w.pending) > 0 && time.Since(w.windowStart) >= w.windowDuration {
		toFlush = w.pending
		w.pending = nil
		w.windowStart = time.Time{}
	}
	w.mu.Unlock()

	if len(toFlush) > 0 && w.onFlush != nil {
		w.onFlush(toFlush)
	}
}

// Add appends a ride request to the pending batch.
// If the buffer was empty, windowStart is anchored to time.Now().
// If the count of pending requests reaches maxBatchSize, it flushes immediately
// without waiting for the background timer.
func (w *Window) Add(request models.RideRequest) {
	var toFlush []models.RideRequest

	w.mu.Lock()
	if len(w.pending) == 0 {
		w.windowStart = time.Now()
	}
	w.pending = append(w.pending, request)

	if len(w.pending) >= w.maxBatchSize {
		toFlush = w.pending
		w.pending = nil
		w.windowStart = time.Time{}
	}
	w.mu.Unlock()

	if len(toFlush) > 0 && w.onFlush != nil {
		w.onFlush(toFlush)
	}
}

// flush captures and clears pending requests under the mutex, resetting windowStart,
// and invokes onFlush outside the lock.
func (w *Window) flush() {
	var toFlush []models.RideRequest

	w.mu.Lock()
	if len(w.pending) > 0 {
		toFlush = w.pending
		w.pending = nil
		w.windowStart = time.Time{}
	}
	w.mu.Unlock()

	if len(toFlush) > 0 && w.onFlush != nil {
		w.onFlush(toFlush)
	}
}

// Stop cleanly terminates the background timer loop and flushes any remaining pending items.
// Safe to call multiple times.
func (w *Window) Stop() {
	w.stopOnce.Do(func() {
		close(w.stopChan)
		<-w.doneChan
		w.flush()
	})
}
