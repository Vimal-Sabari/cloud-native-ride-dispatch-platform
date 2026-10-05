package matchingalgorithms

import (
	"math"
	"math/rand"
	"sync"
	"testing"
	"time"
)

// reference implementation for testing only — intentionally inefficient via full permutation
// enumeration, never to be used outside this test file.
func bruteForceOptimalCost(matrix [][]float64) float64 {
	n := len(matrix)
	if n == 0 {
		return 0.0
	}
	m := len(matrix[0])
	if m == 0 {
		return 0.0
	}

	if n <= m {
		// More columns than rows: assign each row to a unique column from m
		cols := make([]int, m)
		for i := 0; i < m; i++ {
			cols[i] = i
		}
		used := make([]bool, m)
		perm := make([]int, n)
		minCost := math.Inf(1)

		var search func(row int)
		search = func(row int) {
			if row == n {
				cost := 0.0
				for r := 0; r < n; r++ {
					cost += matrix[r][perm[r]]
				}
				if cost < minCost {
					minCost = cost
				}
				return
			}
			for c := 0; c < m; c++ {
				if !used[c] {
					used[c] = true
					perm[row] = c
					search(row + 1)
					used[c] = false
				}
			}
		}
		search(0)
		return minCost
	}

	// More rows than columns: select m rows to match with m columns
	rowUsed := make([]bool, n)
	colPerm := make([]int, m)
	colUsed := make([]bool, m)
	selectedRows := make([]int, m)
	minCost := math.Inf(1)

	var searchCols func(idx int)
	searchCols = func(idx int) {
		if idx == m {
			cost := 0.0
			for i := 0; i < m; i++ {
				cost += matrix[selectedRows[i]][colPerm[i]]
			}
			if cost < minCost {
				minCost = cost
			}
			return
		}
		for c := 0; c < m; c++ {
			if !colUsed[c] {
				colUsed[c] = true
				colPerm[idx] = c
				searchCols(idx + 1)
				colUsed[c] = false
			}
		}
	}

	var selectRows func(start, count int)
	selectRows = func(start, count int) {
		if count == m {
			searchCols(0)
			return
		}
		for r := start; r < n; r++ {
			if !rowUsed[r] {
				rowUsed[r] = true
				selectedRows[count] = r
				selectRows(r+1, count+1)
				rowUsed[r] = false
			}
		}
	}
	selectRows(0, 0)
	return minCost
}

// Hand-verified case 1: 2x2 matrix with an obvious optimal assignment on the diagonal
func TestSolve_HandVerified_2x2(t *testing.T) {
	matrix := [][]float64{
		{1.0, 2.0},
		{2.0, 1.0},
	}

	assignment, totalCost, err := Solve(matrix)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedCost := 2.0
	expectedAssignment := []int{0, 1}

	if math.Abs(totalCost-expectedCost) > 1e-9 {
		t.Errorf("expected totalCost %v, got %v", expectedCost, totalCost)
	}
	if len(assignment) != len(expectedAssignment) {
		t.Fatalf("expected assignment length %d, got %d", len(expectedAssignment), len(assignment))
	}
	for i, v := range expectedAssignment {
		if assignment[i] != v {
			t.Errorf("at row %d: expected column %d, got %d", i, v, assignment[i])
		}
	}
}

// Hand-verified case 2: 3x3 matrix where greedy row-by-row selection fails
//
// Matrix:
//
//	Row 0: [ 10.0,  12.0,  20.0 ]
//	Row 1: [  5.0, 100.0, 100.0 ]
//	Row 2: [ 20.0,  20.0,  20.0 ]
//
// Greedy analysis (picking cheapest available column row-by-row):
//   - Row 0 picks Column 0 (cost 10.0).
//   - Row 1 now CANNOT pick Column 0 (already taken). It is forced to choose between
//     Column 1 (cost 100.0) or Column 2 (cost 100.0) -> cost 100.0.
//   - Row 2 gets remaining Column 2 -> cost 20.0.
//   - Greedy Total = 10.0 + 100.0 + 20.0 = 130.0.
//
// True Global Optimal assignment:
//   - Row 0 -> Column 1 (cost 12.0)
//   - Row 1 -> Column 0 (cost  5.0)  <-- frees up cheap Column 0 for Row 1
//   - Row 2 -> Column 2 (cost 20.0)
//   - Optimal Total = 12.0 + 5.0 + 20.0 = 37.0.
//
// Solve must return the global minimum 37.0, proving Kuhn-Munkres finds the global optimum.
func TestSolve_HandVerified_GreedyTrap_3x3(t *testing.T) {
	matrix := [][]float64{
		{10.0, 12.0, 20.0},
		{5.0, 100.0, 100.0},
		{20.0, 20.0, 20.0},
	}

	assignment, totalCost, err := Solve(matrix)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	greedyCost := 130.0
	optimalCost := 37.0
	expectedAssignment := []int{1, 0, 2}

	if math.Abs(totalCost-greedyCost) < 1e-9 {
		t.Fatalf("Solve produced suboptimal greedy cost 130.0 instead of optimal 37.0")
	}

	if math.Abs(totalCost-optimalCost) > 1e-9 {
		t.Errorf("expected totalCost %v, got %v", optimalCost, totalCost)
	}

	if len(assignment) != 3 {
		t.Fatalf("expected assignment length 3, got %d", len(assignment))
	}
	for i, v := range expectedAssignment {
		if assignment[i] != v {
			t.Errorf("at row %d: expected column %d, got %d", i, v, assignment[i])
		}
	}
}

// Brute-force cross-check property test:
// Tests at least 100 random matrices of sizes 1x1 through 7x7 against exhaustive permutation search.
func TestSolve_BruteForceCrossCheck(t *testing.T) {
	rng := rand.New(rand.NewSource(42))
	iterations := 150

	for iter := 0; iter < iterations; iter++ {
		// Random dimension between 1 and 7
		n := rng.Intn(7) + 1
		matrix := make([][]float64, n)
		for r := 0; r < n; r++ {
			matrix[r] = make([]float64, n)
			for c := 0; c < n; c++ {
				// Random float cost in range 0.0 to 1000.0
				matrix[r][c] = rng.Float64() * 1000.0
			}
		}

		assignment, solveCost, err := Solve(matrix)
		if err != nil {
			t.Fatalf("iteration %d (%dx%d): unexpected error: %v", iter, n, n, err)
		}

		// Verify assignment is a valid permutation of [0..n-1]
		seen := make(map[int]bool)
		recalculatedCost := 0.0
		for r, c := range assignment {
			if c < 0 || c >= n {
				t.Fatalf("iteration %d (%dx%d): invalid column index %d for row %d", iter, n, n, c, r)
			}
			if seen[c] {
				t.Fatalf("iteration %d (%dx%d): duplicate column %d assigned", iter, n, n, c)
			}
			seen[c] = true
			recalculatedCost += matrix[r][c]
		}

		if math.Abs(recalculatedCost-solveCost) > 1e-9 {
			t.Fatalf("iteration %d (%dx%d): solveCost %v != recalculatedCost %v", iter, n, n, solveCost, recalculatedCost)
		}

		bruteCost := bruteForceOptimalCost(matrix)
		if math.Abs(solveCost-bruteCost) > 1e-7 {
			t.Fatalf("iteration %d (%dx%d): Solve cost %v != bruteForce cost %v\nMatrix: %v", iter, n, n, solveCost, bruteCost, matrix)
		}
	}
}

// Rectangular matrix tests: more rows than columns (e.g. 4 requests, 2 drivers)
func TestSolve_Rectangular_MoreRowsThanColumns(t *testing.T) {
	// 4 rows, 2 columns
	matrix := [][]float64{
		{10.0, 50.0},
		{5.0, 10.0},
		{100.0, 80.0},
		{40.0, 20.0},
	}

	assignment, totalCost, err := Solve(matrix)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(assignment) != 4 {
		t.Fatalf("expected assignment length 4, got %d", len(assignment))
	}

	matchedCount := 0
	unmatchedCount := 0
	assignedCols := make(map[int]bool)
	recomputedCost := 0.0

	for r, c := range assignment {
		if c == -1 {
			unmatchedCount++
		} else {
			matchedCount++
			if c < 0 || c >= 2 {
				t.Errorf("row %d assigned to invalid column %d", r, c)
			}
			if assignedCols[c] {
				t.Errorf("column %d assigned more than once", c)
			}
			assignedCols[c] = true
			recomputedCost += matrix[r][c]
		}
	}

	if matchedCount != 2 {
		t.Errorf("expected exactly 2 matched rows, got %d", matchedCount)
	}
	if unmatchedCount != 2 {
		t.Errorf("expected exactly 2 unmatched rows (-1), got %d", unmatchedCount)
	}

	bruteCost := bruteForceOptimalCost(matrix)
	if math.Abs(totalCost-bruteCost) > 1e-9 {
		t.Errorf("totalCost %v does not match bruteForceCost %v", totalCost, bruteCost)
	}
	if math.Abs(totalCost-recomputedCost) > 1e-9 {
		t.Errorf("totalCost %v != recomputedCost %v", totalCost, recomputedCost)
	}
}

// Rectangular matrix tests: more columns than rows (e.g. 2 requests, 4 drivers)
func TestSolve_Rectangular_MoreColumnsThanRows(t *testing.T) {
	// 2 rows, 4 columns
	matrix := [][]float64{
		{10.0, 50.0, 5.0, 30.0},
		{20.0, 10.0, 40.0, 25.0},
	}

	assignment, totalCost, err := Solve(matrix)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(assignment) != 2 {
		t.Fatalf("expected assignment length 2, got %d", len(assignment))
	}

	assignedCols := make(map[int]bool)
	recomputedCost := 0.0
	for r, c := range assignment {
		if c < 0 || c >= 4 {
			t.Errorf("row %d assigned to invalid column %d", r, c)
		}
		if assignedCols[c] {
			t.Errorf("column %d assigned multiple times", c)
		}
		assignedCols[c] = true
		recomputedCost += matrix[r][c]
	}

	bruteCost := bruteForceOptimalCost(matrix)
	if math.Abs(totalCost-bruteCost) > 1e-9 {
		t.Errorf("totalCost %v does not match bruteForceCost %v", totalCost, bruteCost)
	}
	if math.Abs(totalCost-recomputedCost) > 1e-9 {
		t.Errorf("totalCost %v != recomputedCost %v", totalCost, recomputedCost)
	}
}

// Rectangular property cross-check with random dimensions and costs
func TestSolve_Rectangular_RandomCrossCheck(t *testing.T) {
	rng := rand.New(rand.NewSource(12345))
	for iter := 0; iter < 50; iter++ {
		numRows := rng.Intn(6) + 1
		numCols := rng.Intn(6) + 1
		if numRows == numCols {
			numCols++
		}

		matrix := make([][]float64, numRows)
		for r := 0; r < numRows; r++ {
			matrix[r] = make([]float64, numCols)
			for c := 0; c < numCols; c++ {
				matrix[r][c] = rng.Float64() * 500.0
			}
		}

		assignment, solveCost, err := Solve(matrix)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		bruteCost := bruteForceOptimalCost(matrix)
		if math.Abs(solveCost-bruteCost) > 1e-7 {
			t.Fatalf("iter %d (%dx%d): Solve cost %v != bruteForce cost %v", iter, numRows, numCols, solveCost, bruteCost)
		}

		// Verify assignment length and valid column bounds
		if len(assignment) != numRows {
			t.Fatalf("iter %d: expected assignment length %d, got %d", iter, numRows, len(assignment))
		}
	}
}

// Edge Case: 0x0 empty matrix
func TestSolve_EdgeCase_EmptyMatrix(t *testing.T) {
	assignment, cost, err := Solve([][]float64{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(assignment) != 0 || cost != 0.0 {
		t.Errorf("expected empty result, got assignment: %v, cost: %v", assignment, cost)
	}

	assignment2, cost2, err2 := Solve([][]float64{{}})
	if err2 != nil {
		t.Fatalf("unexpected error: %v", err2)
	}
	if len(assignment2) != 0 || cost2 != 0.0 {
		t.Errorf("expected empty result for {{}}, got assignment: %v, cost: %v", assignment2, cost2)
	}
}

// Edge Case: 1x1 matrix
func TestSolve_EdgeCase_1x1(t *testing.T) {
	matrix := [][]float64{{42.5}}
	assignment, cost, err := Solve(matrix)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(assignment) != 1 || assignment[0] != 0 {
		t.Errorf("expected [0], got %v", assignment)
	}
	if math.Abs(cost-42.5) > 1e-9 {
		t.Errorf("expected 42.5, got %v", cost)
	}
}

// Edge Case: All equal costs
func TestSolve_EdgeCase_AllEqual(t *testing.T) {
	n := 4
	val := 7.5
	matrix := make([][]float64, n)
	for r := 0; r < n; r++ {
		matrix[r] = make([]float64, n)
		for c := 0; c < n; c++ {
			matrix[r][c] = val
		}
	}

	assignment, cost, err := Solve(matrix)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedCost := float64(n) * val
	if math.Abs(cost-expectedCost) > 1e-9 {
		t.Errorf("expected totalCost %v, got %v", expectedCost, cost)
	}

	// Verify valid permutation
	seen := make(map[int]bool)
	for _, c := range assignment {
		if c < 0 || c >= n || seen[c] {
			t.Errorf("invalid or duplicate assignment: %v", assignment)
		}
		seen[c] = true
	}
}

// Error handling: inconsistent row lengths
func TestSolve_Errors_InconsistentDimensions(t *testing.T) {
	matrix := [][]float64{
		{1.0, 2.0},
		{3.0},
	}
	_, _, err := Solve(matrix)
	if err == nil {
		t.Fatal("expected error for jagged matrix, got nil")
	}
}

// Error handling: NaN and Inf
func TestSolve_Errors_NonFinite(t *testing.T) {
	nanMatrix := [][]float64{
		{1.0, math.NaN()},
		{3.0, 4.0},
	}
	_, _, err := Solve(nanMatrix)
	if err == nil {
		t.Fatal("expected error for NaN, got nil")
	}

	infMatrix := [][]float64{
		{1.0, 2.0},
		{math.Inf(1), 4.0},
	}
	_, _, err2 := Solve(infMatrix)
	if err2 == nil {
		t.Fatal("expected error for Inf, got nil")
	}
}

// Concurrency safety test: calling Solve concurrently across multiple goroutines
func TestSolve_ConcurrencySafety(t *testing.T) {
	const numGoroutines = 50
	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for g := 0; g < numGoroutines; g++ {
		go func(seed int64) {
			defer wg.Done()
			rng := rand.New(rand.NewSource(seed + time.Now().UnixNano()))
			matrix := [][]float64{
				{rng.Float64() * 10, rng.Float64() * 20},
				{rng.Float64() * 30, rng.Float64() * 40},
			}
			assign, cost, err := Solve(matrix)
			if err != nil {
				t.Errorf("goroutine failed with error: %v", err)
			}
			if len(assign) != 2 || cost < 0 {
				t.Errorf("invalid result: %v, cost: %v", assign, cost)
			}
		}(int64(g))
	}

	wg.Wait()
}
