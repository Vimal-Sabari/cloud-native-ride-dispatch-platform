package matcher

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
)

// TestWindow_FlushOnTimer verifies that requests added to the window are not flushed
// prematurely before windowDuration elapses, and are flushed promptly once the duration expires.
func TestWindow_FlushOnTimer(t *testing.T) {
	flushedBatches := make(chan []models.RideRequest, 10)
	duration := 80 * time.Millisecond

	window := NewWindow(duration, 50, func(batch []models.RideRequest) {
		flushedBatches <- batch
	})
	defer window.Stop()

	req := models.RideRequest{RideID: "ride-1"}
	window.Add(req)

	// Verify no flush occurred before duration elapses
	select {
	case <-flushedBatches:
		t.Fatal("unexpected premature flush before windowDuration elapsed")
	case <-time.After(30 * time.Millisecond):
		// Expected: still waiting for window to expire
	}

	// Verify flush arrives shortly after the 80ms window duration
	select {
	case batch := <-flushedBatches:
		if len(batch) != 1 || batch[0].RideID != "ride-1" {
			t.Fatalf("expected batch containing ride-1, got %+v", batch)
		}
	case <-time.After(150 * time.Millisecond):
		t.Fatal("timeout waiting for timer-triggered flush")
	}
}

// TestWindow_FlushOnMaxSize verifies that adding maxBatchSize requests triggers an
// immediate flush without waiting for the background timer.
func TestWindow_FlushOnMaxSize(t *testing.T) {
	flushedBatches := make(chan []models.RideRequest, 10)
	maxBatchSize := 5
	// Very long duration: if it flushes quickly, it must be due to maxBatchSize
	duration := 10 * time.Second

	window := NewWindow(duration, maxBatchSize, func(batch []models.RideRequest) {
		flushedBatches <- batch
	})
	defer window.Stop()

	start := time.Now()
	for i := 0; i < maxBatchSize; i++ {
		window.Add(models.RideRequest{RideID: fmt.Sprintf("ride-%d", i)})
	}

	select {
	case batch := <-flushedBatches:
		elapsed := time.Since(start)
		if elapsed > 200*time.Millisecond {
			t.Errorf("flush took too long (%v); expected immediate flush on maxBatchSize", elapsed)
		}
		if len(batch) != maxBatchSize {
			t.Fatalf("expected batch of size %d, got %d", maxBatchSize, len(batch))
		}
		for i := 0; i < maxBatchSize; i++ {
			expectedID := fmt.Sprintf("ride-%d", i)
			if batch[i].RideID != expectedID {
				t.Errorf("batch[%d] = %s; want %s", i, batch[i].RideID, expectedID)
			}
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for immediate max-size flush")
	}
}

// TestWindow_ConcurrentAdd_RaceClean tests that multiple goroutines calling Add simultaneously
// with the background flush timer active results in zero lost or duplicated requests,
// and runs completely race-clean under `go test -race`.
func TestWindow_ConcurrentAdd_RaceClean(t *testing.T) {
	const (
		numGoroutines     = 20
		requestsPerWorker = 25
		totalRequests     = numGoroutines * requestsPerWorker
	)

	var mu sync.Mutex
	receivedRideIDs := make(map[string]int)
	var totalReceivedCount int64

	windowDuration := 25 * time.Millisecond
	maxBatchSize := 10

	window := NewWindow(windowDuration, maxBatchSize, func(batch []models.RideRequest) {
		mu.Lock()
		defer mu.Unlock()
		for _, req := range batch {
			receivedRideIDs[req.RideID]++
			atomic.AddInt64(&totalReceivedCount, 1)
		}
	})

	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for g := 0; g < numGoroutines; g++ {
		go func(workerID int) {
			defer wg.Done()
			for r := 0; r < requestsPerWorker; r++ {
				reqID := fmt.Sprintf("w%d-r%d", workerID, r)
				window.Add(models.RideRequest{RideID: reqID})
				// Small jitter to interleave adds and background flushes
				if r%5 == 0 {
					time.Sleep(2 * time.Millisecond)
				}
			}
		}(g)
	}

	wg.Wait()

	// Stop cleanly to flush any remaining requests buffered in pending
	window.Stop()

	mu.Lock()
	defer mu.Unlock()

	if int(totalReceivedCount) != totalRequests {
		t.Fatalf("expected %d total flushed requests, got %d", totalRequests, totalReceivedCount)
	}

	if len(receivedRideIDs) != totalRequests {
		t.Fatalf("expected %d unique requests, got %d", totalRequests, len(receivedRideIDs))
	}

	for id, count := range receivedRideIDs {
		if count != 1 {
			t.Errorf("ride %s appeared %d times (expected exactly 1)", id, count)
		}
	}
}

// TestWindow_StopIdempotent verifies that calling Stop multiple times does not panic
// and drains any un-flushed pending requests.
func TestWindow_StopIdempotent(t *testing.T) {
	var mu sync.Mutex
	var flushed []models.RideRequest

	window := NewWindow(10*time.Second, 100, func(batch []models.RideRequest) {
		mu.Lock()
		flushed = append(flushed, batch...)
		mu.Unlock()
	})

	window.Add(models.RideRequest{RideID: "unflushed-1"})
	window.Add(models.RideRequest{RideID: "unflushed-2"})

	// First Stop should flush remaining pending items
	window.Stop()

	// Subsequent Stop calls should be safe no-ops
	window.Stop()
	window.Stop()

	mu.Lock()
	defer mu.Unlock()
	if len(flushed) != 2 {
		t.Fatalf("expected 2 flushed requests upon Stop, got %d", len(flushed))
	}
}
