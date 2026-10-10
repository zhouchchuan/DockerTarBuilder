#define main media_local_test_main
#include "media_engine_test.cpp"
#undef main
int main(int argc,char** argv) {
  try {
    check(argc==4,"URL, CA, expected result required");
    Counters counters; Engine engine(std::make_unique<Headless>(counters),-1,argv[1],argv[2]);
    engine.start();
    if(std::string(argv[3])=="reject") {
      auto end=monotonicMs()+10000;
      while(engine.status()["error"]=="" && monotonicMs()<end) std::this_thread::sleep_for(std::chrono::milliseconds(20));
      check(engine.status()["error"]!="","untrusted TLS must be rejected");
      check(counters.frames==0,"untrusted TLS must not emit video");
    } else {
      waitFor(engine,[&](const Json& s){return s["ready"].get<bool>()&&counters.frames>2;});
      check(engine.status()["decoder"]=="dav1d","AV1 must actually use dav1d");
    }
    engine.stop();std::cout<<"PASS HTTPS AV1 "<<argv[3]<<std::endl;return 0;
  } catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
