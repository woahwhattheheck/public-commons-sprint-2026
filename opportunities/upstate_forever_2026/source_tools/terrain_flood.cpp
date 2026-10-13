// TokenJunkieLabs. Original implementation of the documented minimax flood.
// Method: Barnes, Lehman & Mulla (2014), doi:10.1016/j.cageo.2013.04.024.
// This input conditioner does not replace InVEST's own flow-routing model.
#include <algorithm>
#include <cstdint>
#include <deque>
#include <fstream>
#include <iostream>
#include <limits>
#include <queue>
#include <stdexcept>
#include <string>
#include <vector>
#include <cmath>
struct Cell { double z; std::uint64_t i; };
struct Greater { bool operator()(const Cell&a,const Cell&b) const {
    return a.z>b.z || (a.z==b.z && a.i>b.i);
}};
template<class T> std::vector<T> load(const char*path,std::uint64_t n) {
    std::ifstream f(path,std::ios::binary|std::ios::ate);
    if(!f || f.tellg()!=std::streamoff(n*sizeof(T))) throw std::runtime_error("Array length differs");
    std::vector<T> a(n); f.seekg(0); f.read(reinterpret_cast<char*>(a.data()), n*sizeof(T));
    if(!f) throw std::runtime_error("Incomplete input array"); return a;
}
int main(int argc,char**argv) { try {
    if(argc!=7) throw std::runtime_error("width height elevation valid seeds output required");
    const auto w=std::stoull(argv[1]), h=std::stoull(argv[2]);
    if(!w||!h||w>std::numeric_limits<std::uint64_t>::max()/h) throw std::runtime_error("Invalid grid");
    const auto n=w*h; auto z=load<double>(argv[3],n);
    const auto valid=load<std::uint8_t>(argv[4],n), seeds=load<std::uint8_t>(argv[5],n);
    std::vector<std::uint8_t> seen(n,0);
    std::priority_queue<Cell,std::vector<Cell>,Greater> open;
    std::deque<Cell> pit;
    std::uint64_t total=0, processed=0;
    for(std::uint64_t i=0;i<n;++i) {
        if(valid[i]) {++total; if(!std::isfinite(z[i])) throw std::runtime_error("Nonfinite valid elevation");}
        if(seeds[i]&&valid[i]) {seen[i]=1;open.push({z[i],i});}
    }
    constexpr int dx[8]={1,1,0,-1,-1,-1,0,1};
    constexpr int dy[8]={0,1,1,1,0,-1,-1,-1};
    while(!open.empty()||!pit.empty()) {
        Cell c;
        if(!pit.empty()){c=pit.front();pit.pop_front();}
        else {c=open.top();open.pop();}
        ++processed;
        const auto x=c.i%w,y=c.i/w;
        for(int d=0;d<8;++d) {
            const auto nx=static_cast<std::int64_t>(x)+dx[d],ny=static_cast<std::int64_t>(y)+dy[d];
            if(nx<0||ny<0||nx>=static_cast<std::int64_t>(w)||ny>=static_cast<std::int64_t>(h))continue;
            const auto j=static_cast<std::uint64_t>(ny)*w+nx;
            if(seen[j]||!valid[j])continue;
            seen[j]=1;
            if(z[j]<=c.z){z[j]=c.z;pit.push_back({c.z,j});}
            else open.push({z[j],j});
        }
        if((processed&262143)==0)std::cerr<<"cells "<<processed<<" "<<total<<"\n";
    }
    if(processed!=total) throw std::runtime_error("Some valid cells have no path to a selected boundary outlet");
    std::ofstream out(argv[6],std::ios::binary|std::ios::trunc);
    out.write(reinterpret_cast<const char*>(z.data()),n*sizeof(double));out.close();
    if(!out)throw std::runtime_error("Could not write complete output");
    std::cout<<processed<<"\n"; return 0;
} catch(const std::exception&e){std::cerr<<e.what()<<"\n";return 2;} }
