// Package matchingalgorithms provides graph matching algorithms for the ride-dispatch-platform.
//
// Concurrency Safety & Complexity:
// All functions in this package, including Solve, are strictly pure and stateless.
// They allocate all working memory locally and do not read or write any package-level
// or global state. Solve is safe to call concurrently from multiple goroutines.
// The algorithm runs in strictly O(n^3) time where n = max(numRows, numCols).
package matchingalgorithms

import (
	"fmt"
	"math"
)

// Solve implements the Hungarian (Kuhn-Munkres) algorithm to find the minimum-cost
// bipartite matching for a given cost matrix.
//
// Parameters:
//   - costMatrix: an N x M matrix where costMatrix[i][j] represents the cost of assigning
//     row i (e.g., ride request) to column j (e.g., driver).
//
// Returns:
//   - assignment: a slice of length N where assignment[i] is the column index assigned to row i,
//     or -1 if row i could not be assigned to a real column (in rectangular cases where N > M).
//   - totalCost: the sum of the original costs for all real (non-dummy) assigned pairs.
//   - err: error if matrix dimensions are inconsistent or contain non-finite numbers (NaN/Inf).
//
// Special Cases & Rectangular Matrices:
//   - Empty matrix (0 rows or 0 columns) immediately returns ([]int{}, 0.0, nil).
//   - If N != M, the matrix is padded to a square K x K matrix (K = max(N, M)) using dummy
//     rows or columns initialized with a large sentinel cost value.
//   - Sentinel Strategy: We choose sentinel = 10 * max(|cost|, 1.0) + 100.0.
//     Reasoning: A dynamic multiplier strictly greater than any real cost ensures real
//     assignments are always preferred over dummy assignments, while staying well within
//     floating-point range to prevent overflow (unlike math.MaxFloat64 which produces Inf/NaN
//     during dual potential additions and subtractions: cost - u - v).
//   - After solving the K x K system, assignments to dummy columns are set to -1, dummy
//     rows are pruned, and totalCost is accumulated using solely original real costs.
func Solve(costMatrix [][]float64) ([]int, float64, error) {
	numRows := len(costMatrix)
	if numRows == 0 {
		return []int{}, 0.0, nil
	}
	numCols := len(costMatrix[0])
	if numCols == 0 {
		return []int{}, 0.0, nil
	}

	// 1. Validate matrix dimension consistency and numerical finiteness
	maxAbsCost := 0.0
	for r := 0; r < numRows; r++ {
		if len(costMatrix[r]) != numCols {
			return nil, 0.0, fmt.Errorf("inconsistent matrix dimensions: row %d has length %d, expected %d", r, len(costMatrix[r]), numCols)
		}
		for c := 0; c < numCols; c++ {
			val := costMatrix[r][c]
			if math.IsNaN(val) || math.IsInf(val, 0) {
				return nil, 0.0, fmt.Errorf("invalid cost at row %d, col %d: %v", r, c, val)
			}
			abs := math.Abs(val)
			if abs > maxAbsCost {
				maxAbsCost = abs
			}
		}
	}

	// 2. Pad rectangular matrices to square K x K using safe sentinel cost
	n := numRows
	if numCols > n {
		n = numCols
	}

	// Sentinel cost for dummy rows/columns.
	// Using 10x the maximum absolute cost found in the input matrix (plus a positive offset)
	// ensures that real edges are strictly favored over dummy edges, while avoiding
	// math.MaxFloat64 which would easily overflow during dual potential subtraction/addition.
	sentinel := 10.0*math.Max(maxAbsCost, 1.0) + 100.0

	paddedMatrix := make([][]float64, n)
	for r := 0; r < n; r++ {
		paddedMatrix[r] = make([]float64, n)
		for c := 0; c < n; c++ {
			if r < numRows && c < numCols {
				paddedMatrix[r][c] = costMatrix[r][c]
			} else {
				paddedMatrix[r][c] = sentinel
			}
		}
	}

	// 3. O(n^3) Hungarian Algorithm with Dual Potentials and Augmenting Paths
	//
	// Dual variables:
	//   u[1..n] = row potentials (1-indexed)
	//   v[0..n] = column potentials (1-indexed for real cols, v[0] tracks objective)
	//   p[0..n] = column matching (p[j] stores row matched with col j; p[0] is root)
	//   way[1..n] = back-pointers for augmenting path reconstruction
	u := make([]float64, n+1)
	v := make([]float64, n+1)
	p := make([]int, n+1)
	way := make([]int, n+1)

	for i := 1; i <= n; i++ {
		p[0] = i
		j0 := 0
		minv := make([]float64, n+1)
		for j := 1; j <= n; j++ {
			minv[j] = math.Inf(1)
		}
		used := make([]bool, n+1)

		for {
			used[j0] = true
			i0 := p[j0]
			delta := math.Inf(1)
			j1 := 0

			for j := 1; j <= n; j++ {
				if !used[j] {
					cur := paddedMatrix[i0-1][j-1] - u[i0] - v[j]
					if cur < minv[j] {
						minv[j] = cur
						way[j] = j0
					}
					if minv[j] < delta {
						delta = minv[j]
						j1 = j
					}
				}
			}

			// Update dual potentials
			for j := 0; j <= n; j++ {
				if used[j] {
					u[p[j]] += delta
					v[j] -= delta
				} else {
					minv[j] -= delta
				}
			}

			j0 = j1
			if p[j0] == 0 {
				break
			}
		}

		// Augment along the alternating path
		for j0 != 0 {
			prev := way[j0]
			p[j0] = p[prev]
			j0 = prev
		}
	}

	// 4. Extract padded matching (0-indexed row -> 0-indexed column)
	paddedAssignment := make([]int, n)
	for j := 1; j <= n; j++ {
		row := p[j] - 1
		if row >= 0 && row < n {
			paddedAssignment[row] = j - 1
		}
	}

	// 5. Project back to original dimensions:
	// - For each real row r < numRows:
	//   If assigned column c < numCols, it's a real match -> assignment[r] = c, add original cost.
	//   If assigned column c >= numCols, row matched a dummy column -> assignment[r] = -1.
	// - Dummy rows (r >= numRows) are stripped completely.
	assignment := make([]int, numRows)
	totalCost := 0.0

	for r := 0; r < numRows; r++ {
		col := paddedAssignment[r]
		if col < numCols {
			assignment[r] = col
			totalCost += costMatrix[r][col]
		} else {
			assignment[r] = -1
		}
	}

	return assignment, totalCost, nil
}
