// Exact one-dimensional subset matching with mandatory targets and optional controls.
// The implicit treap stores the sorted discrete slopes of the prefix cost function.
// No treatment-by-candidate matrix is allocated. See REGIONAL_MATCHED_CONTROL.md.
#include <algorithm>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using I = std::int64_t;
using U = std::uint64_t;
using N = std::uint32_t;
using Wide = __int128_t;

static std::string decimal(Wide v) {
    if (!v) return "0";
    bool negative = v < 0;
    if (negative) v = -v;
    std::string s;
    while (v) { s.push_back(char('0' + v % 10)); v /= 10; }
    if (negative) s.push_back('-');
    std::reverse(s.begin(), s.end());
    return s;
}
static U mix(U x) {
    x += 0x9e3779b97f4a7c15ULL;
    x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
    return x ^ (x >> 31);
}
static U read_u64(std::istream& in) {
    unsigned char b[8];
    if (!in.read(reinterpret_cast<char*>(b), 8)) throw std::runtime_error("Truncated matcher input");
    U v = 0;
    for (int k = 0; k < 8; ++k) v |= U(b[k]) << (8 * k);
    return v;
}
static void write_u64(std::ostream& out, U v) {
    unsigned char b[8];
    for (int k = 0; k < 8; ++k) b[k] = (v >> (8 * k)) & 255;
    out.write(reinterpret_cast<const char*>(b), 8);
}
struct Event {
    I position;
    U cell;
    I threshold;
    bool target;
};
struct Node {
    I value = 0, lazy = 0;
    U priority = 0;
    N left = 0, right = 0, size = 1;
};
class Slopes {
    std::vector<Node> nodes;
    N count(N p) const { return p ? nodes[p].size : 0; }
    void pull(N p) { nodes[p].size = 1 + count(nodes[p].left) + count(nodes[p].right); }
    void add(N p, I v) { if (p) { nodes[p].value += v; nodes[p].lazy += v; } }
    void push(N p) {
        if (p && nodes[p].lazy) {
            const I v = nodes[p].lazy;
            add(nodes[p].left, v); add(nodes[p].right, v); nodes[p].lazy = 0;
        }
    }
    std::pair<N,N> split(N root, N k) {
        if (!root) return {0,0};
        push(root);
        const N left = count(nodes[root].left);
        if (k <= left) {
            auto p = split(nodes[root].left, k);
            nodes[root].left = p.second; pull(root); return {p.first, root};
        }
        auto p = split(nodes[root].right, k - left - 1);
        nodes[root].right = p.first; pull(root); return {root, p.second};
    }
    N merge(N a, N b) {
        if (!a || !b) return a ? a : b;
        if (nodes[a].priority > nodes[b].priority) {
            push(a); nodes[a].right = merge(nodes[a].right, b); pull(a); return a;
        }
        push(b); nodes[b].left = merge(a, nodes[b].left); pull(b); return b;
    }
public:
    N root = 0;
    explicit Slopes(U capacity) { nodes.reserve(capacity + 1); nodes.emplace_back(); }
    N negatives() {
        N p = root, rank = 0;
        while (p) {
            push(p);
            if (nodes[p].value < 0) { rank += 1 + count(nodes[p].left); p = nodes[p].right; }
            else p = nodes[p].left;
        }
        return rank;
    }
    void gap(N negative_count, I distance) {
        if (!root || !distance) return;
        auto p = split(root, negative_count);
        add(p.first, -distance); add(p.second, distance);
        root = merge(p.first, p.second);
    }
    void insert_zero(N rank) {
        Node node; node.priority = mix(nodes.size()); nodes.push_back(node);
        N id = static_cast<N>(nodes.size() - 1);
        auto p = split(root, rank); root = merge(merge(p.first, id), p.second);
    }
    Wide sum_first(N remaining) {
        Wide total = 0;
        std::vector<N> stack;
        N p = root;
        while ((p || !stack.empty()) && remaining) {
            while (p) { push(p); stack.push_back(p); p = nodes[p].left; }
            p = stack.back(); stack.pop_back();
            total += nodes[p].value; --remaining; p = nodes[p].right;
        }
        if (remaining) throw std::runtime_error("Incomplete slope prefix");
        return total;
    }
};
int main(int argc, char** argv) {
    try {
        if (argc != 3) throw std::runtime_error("Usage: matched-control-exact INPUT.bin OUTPUT.bin");
        std::ifstream input(argv[1], std::ios::binary);
        if (!input) throw std::runtime_error("Cannot open matcher input");
        char magic[8];
        if (!input.read(magic, 8) || std::string(magic, 8) != "ECO1D01\n")
            throw std::runtime_error("Incorrect matcher input format");
        const U target_count = read_u64(input), candidate_count = read_u64(input);
        if (candidate_count < target_count || candidate_count > std::numeric_limits<N>::max() - 1ULL
            || target_count > std::numeric_limits<N>::max() - 1ULL)
            throw std::runtime_error("Insufficient controls or unsupported record count");
        std::vector<Event> events; events.reserve(target_count + candidate_count);
        for (U j = 0; j < target_count + candidate_count; ++j) {
            const U value = read_u64(input), cell = read_u64(input);
            if (value > (1ULL << 61)) throw std::runtime_error("Coordinate exceeds exact matcher range");
            events.push_back({static_cast<I>(value), cell, 0, j < target_count});
        }
        if (input.peek() != std::char_traits<char>::eof()) throw std::runtime_error("Trailing matcher input bytes");
        std::sort(events.begin(), events.end(), [](const Event& a, const Event& b) {
            if (a.position != b.position) return a.position < b.position;
            if (a.target != b.target) return a.target > b.target;
            return a.cell < b.cell;
        });
        Slopes slopes(candidate_count);
        U targets = 0, supplies = 0;
        Wide base = 0;
        I previous = events.empty() ? 0 : events.front().position;
        for (auto& e : events) {
            const I distance = e.position - previous;
            const I lower = I(targets) - I(supplies);
            base += Wide(lower < 0 ? -lower : lower) * distance;
            slopes.gap(static_cast<N>(supplies > targets ? supplies - targets : 0), distance);
            previous = e.position;
            if (e.target) ++targets;
            else {
                const N rank = slopes.negatives();
                e.threshold = lower + rank;
                slopes.insert_zero(rank); ++supplies;
            }
        }
        const Wide optimal = base + slopes.sum_first(static_cast<N>(supplies - targets));
        std::vector<Event> chosen; chosen.reserve(target_count);
        I imbalance = 0;
        for (auto it = events.rbegin(); it != events.rend(); ++it) {
            if (it->target) --imbalance;
            else if (imbalance < it->threshold) { chosen.push_back(*it); ++imbalance; }
        }
        if (imbalance || chosen.size() != target_count) throw std::runtime_error("Incomplete exact reconstruction");
        std::reverse(chosen.begin(), chosen.end());
        // Chosen candidates and required targets are now in precipitation/cell order.
        std::ofstream output(argv[2], std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("Cannot open matcher output");
        output.write("ECOPA01\n", 8); write_u64(output, target_count);
        Wide measured = 0; U j = 0;
        for (const auto& target : events) if (target.target) {
            const auto& control = chosen[j++];
            const I residual = control.position - target.position;
            measured += residual < 0 ? -Wide(residual) : Wide(residual);
            write_u64(output, target.cell); write_u64(output, control.cell);
            write_u64(output, static_cast<U>(residual));
        }
        if (measured != optimal) throw std::runtime_error("Reconstructed pairs differ from the exact prefix optimum");
        output.flush();
        if (!output) throw std::runtime_error("Matcher output write failed");
        std::cout << "{\"algorithm\":\"convex-prefix-exact-l1/v1\",\"targets\":" << target_count
                  << ",\"candidates\":" << candidate_count << ",\"selected\":" << chosen.size()
                  << ",\"objective_integer_units\":\"" << decimal(measured)
                  << "\",\"prefix_optimum_integer_units\":\"" << decimal(optimal)
                  << "\",\"node_bytes\":" << sizeof(Node) << ",\"event_bytes\":" << sizeof(Event)
                  << "}" << std::endl;
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "matched-control-exact: " << error.what() << std::endl;
        return 1;
    }
}
